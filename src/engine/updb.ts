/**
 * UPDB 解析（V0.2.9）：iRead「爱读书」私有格式
 *
 * 实测样本结构（1010490774.updb，114KB）：
 *   容器 = Palm PDB（type "BOOK" / creator "MTIU"，位于头部 0x40~0x47）
 *   - PDB 头 78 字节，numRecords 在 offset 76，记录表 78 起每 8 字节（offset 4 + attr 1 + uid 3）
 *   - 记录 0：二进制元数据头
 *   - 记录 1：书名/作者页（UTF-16LE 文本）
 *   - 记录 2..N-1：正文，一条记录 = 一章，编码 UTF-16LE（\r\n 换行，U+3000 段首缩进）
 *   正文未加密，直接解码即可。
 *
 * 兼容性：逐记录做「可打印中文比例」探测，UTF-16LE 不通时自动回退
 * UTF-16BE → GBK → UTF-8，避免不同批次文件编码差异导致乱码。
 */

export interface ParsedUpdb {
  title: string;
  author: string;
  chapters: ParsedChapter[];
}

export interface ParsedChapter {
  title: string;
  html: string;
  chars: number;
}

const ENCODINGS = ['utf-16le', 'utf-16be', 'gbk', 'utf-8'] as const;

/** 判断是否为 iRead UPDB（Palm PDB + creator MTIU） */
export function isUpdb(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 128) return false;
  const head = new Uint8Array(buf, 0, 96);
  const sig = (off: number) => String.fromCharCode(...head.slice(off, off + 4));
  // 常见位置：type@0x3C/creator@0x40（标准 PDB）或整体后移 4 字节（本样本）
  return sig(0x40) === 'MTIU' || sig(0x44) === 'MTIU' || sig(0x3c) === 'MTIU';
}

/** 可打印字符占比（用于判断该记录是否为干净文本，避免把二进制头当书名页） */
function cleanRatio(text: string): number {
  if (!text) return 0;
  let good = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c >= 0x20 && c < 0x7f) || c === 0x0a || c === 0x0d || c === 0x09 || (c >= 0x3000 && c <= 0x9fff)) good++;
  }
  return good / text.length;
}

function decodeBest(bytes: Uint8Array): string {
  let best = '';
  let bestScore = -1;
  for (const enc of ENCODINGS) {
    let text = '';
    try {
      text = new TextDecoder(enc, { fatal: false }).decode(bytes);
    } catch {
      continue;
    }
    if (!text) continue;
    let good = 0;
    let total = 0;
    for (const ch of text) {
      total++;
      const c = ch.codePointAt(0) ?? 0;
      // 计入：CJK、全角标点、ASCII 可见字符、换行/制表
      if (
        (c >= 0x4e00 && c <= 0x9fff) ||
        (c >= 0x3000 && c <= 0x303f) ||
        (c >= 0xff00 && c <= 0xffef) ||
        (c >= 0x20 && c < 0x7f) ||
        c === 0x0a ||
        c === 0x0d ||
        c === 0x09
      ) {
        good++;
      }
    }
    const score = total ? good / total : 0;
    // 中文内容加权：汉字越多越可能是正确编码
    const han = (text.match(/[一-鿿]/g) ?? []).length;
    const final = score + Math.min(0.25, han / Math.max(1, total));
    if (final > bestScore) {
      bestScore = final;
      best = text;
    }
  }
  return best;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 纯文本 → 章节 HTML：\r\n\r\n 分段，去掉段首多余全角空格（交给 CSS 缩进） */
function textToHtml(text: string): string {
  const paras = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^[　\s]+/gm, '').trim())
    .filter((p) => p.length > 0);
  return paras.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join('');
}

/** 首行是否像章节标题（短、无句末标点） */
function looksLikeTitle(line: string): boolean {
  const t = line.trim().replace(/^[　\s]+/, '');
  if (!t || t.length > 40) return false;
  if (/[。！？，、；：」』）]$/.test(t)) return false;
  return /^(第[一二三四五六七八九十百零\d]+[章节回卷篇部]|序[文言]?|楔子|前言|後記|后记|附[錄录]|引[言子])/.test(t) || t.length <= 20;
}

export async function parseUpdb(buf: ArrayBuffer, fallbackTitle: string): Promise<ParsedUpdb> {
  if (!isUpdb(buf)) throw new Error('不是有效的 UPDB 文件（未检测到 iRead MTIU 标识）');

  const dv = new DataView(buf);
  const numRecords = dv.getUint16(76, false);
  if (numRecords < 2 || numRecords > 20000) throw new Error('UPDB 记录数异常，文件可能损坏');

  const offsets: number[] = [];
  for (let i = 0; i < numRecords; i++) {
    const o = 78 + i * 8;
    if (o + 4 > buf.byteLength) break;
    offsets.push(dv.getUint32(o, false));
  }
  offsets.push(buf.byteLength);

  let title = '';
  let author = '';
  const chapters: ParsedChapter[] = [];

  for (let i = 0; i < offsets.length - 1; i++) {
    const s = offsets[i];
    const e = offsets[i + 1];
    if (e <= s || s >= buf.byteLength) continue;
    const rec = new Uint8Array(buf, s, Math.min(e, buf.byteLength) - s);
    if (rec.length < 8) continue;

    const text = decodeBest(rec).replace(/^﻿/, '');
    if (!text.trim()) continue;

    // 记录 0 恒为二进制头，跳过
    if (i === 0) continue;

    // 记录 1（首个短且干净的文本记录）作书名/作者页
    if (!title && rec.length < 4096 && i <= 2 && cleanRatio(text) > 0.8) {
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length) {
        const first = lines[0].replace(/^[︽《「『*#\s]+|[︾》」』\s]+$/g, '').trim();
        if (first) title = first.slice(0, 80);
        for (const l of lines.slice(1, 4)) {
          const m = l.match(/^([^\s　]{1,20})[　\s]*(著|口述|整理|執筆|执笔|編著|编著|譯|译|作)/);
          if (m) {
            author = m[1];
            break;
          }
        }
      }
      continue;
    }

    const lines = text.split(/\r?\n/);
    const head = (lines[0] ?? '').trim().replace(/^[　\s]+/, '');
    const body = looksLikeTitle(head) ? lines.slice(1).join('\n') : text;
    const chapterTitle = looksLikeTitle(head) ? head : `第 ${chapters.length + 1} 节`;
    const html = textToHtml(body);
    const chars = body.replace(/\s/g, '').length;
    if (!chars) continue;
    chapters.push({ title: chapterTitle.slice(0, 60), html, chars });
  }

  if (!chapters.length) throw new Error('UPDB 解析失败：未取到正文内容');
  return {
    title: title || fallbackTitle,
    author,
    chapters,
  };
}
