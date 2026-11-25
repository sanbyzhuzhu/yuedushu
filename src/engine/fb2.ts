/** FB2（FictionBook 2.0）解析（V0.3.2）：XML → 章节化 HTML；
 *  支持 .fb2 与 .fb2.zip；图片来自 <binary> base64（免再编码直接 data URL）；
 *  DOM 遍历用 localName 递归（兼容浏览器与 linkedom，规避命名空间 API 差异） */
import { unzipBook } from './archive';
import type { ParsedChapter } from './epub';

export interface ParsedFb2 {
  title: string;
  author: string;
  cover?: string;
  chapters: ParsedChapter[];
}

/** XML 文本解码：BOM → 声明编码 → utf-8 兜底 */
function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 200));
  const m = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
  const enc = (m?.[1] ?? 'utf-8').toLowerCase();
  if (enc && enc !== 'utf-8' && enc !== 'utf8') {
    try {
      return new TextDecoder(enc).decode(bytes);
    } catch {
      /* 不支持的编码名回退 utf-8 */
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function kids(n: Node): Node[] {
  return Array.prototype.slice.call(n.childNodes) as Node[];
}

/** 按 localName 深度收集元素（FB2 可能带默认命名空间或 fb: 前缀） */
function byLocal(root: Node, name: string): Element[] {
  const out: Element[] = [];
  const walk = (n: Node): void => {
    for (const c of kids(n)) {
      if (c.nodeType === 1) {
        if ((c as Element).localName === name) out.push(c as Element);
        walk(c);
      }
    }
  };
  walk(root);
  return out;
}

function firstLocal(root: Node, name: string): Element | null {
  return byLocal(root, name)[0] ?? null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hrefOf(el: Element): string {
  return el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') || '';
}

/** 行内转换 */
function inlineHtml(el: Element, images: Map<string, string>): string {
  let out = '';
  for (const n of kids(el)) {
    if (n.nodeType === 3) {
      out += esc(n.textContent ?? '');
    } else if (n.nodeType === 1) {
      const c = n as Element;
      switch (c.localName) {
        case 'emphasis':
          out += `<em>${inlineHtml(c, images)}</em>`;
          break;
        case 'strong':
          out += `<strong>${inlineHtml(c, images)}</strong>`;
          break;
        case 'style':
          out += `<span>${inlineHtml(c, images)}</span>`;
          break;
        case 'a':
          out += inlineHtml(c, images); // 去链接留文本
          break;
        case 'image': {
          const data = images.get(hrefOf(c).replace(/^#/, ''));
          out += data ? `<img src="${data}" />` : '';
          break;
        }
        default:
          out += inlineHtml(c, images);
      }
    }
  }
  return out;
}

/** 块级转换（section 内容体） */
function blockHtml(el: Element, images: Map<string, string>): string {
  switch (el.localName) {
    case 'p':
      return `<p>${inlineHtml(el, images)}</p>`;
    case 'subtitle':
      return `<h3>${inlineHtml(el, images)}</h3>`;
    case 'cite':
    case 'epigraph':
      return `<blockquote>${inlineHtml(el, images)}</blockquote>`;
    case 'poem': {
      let poem = '';
      for (const n of kids(el)) {
        if (n.nodeType !== 1) continue;
        const c = n as Element;
        if (c.localName === 'stanza') {
          poem += '<p>';
          for (const v of byLocal(c, 'v')) poem += `${esc((v.textContent ?? '').trim())}<br />`;
          poem += '</p>';
        } else if (c.localName === 'title') {
          poem += `<h3>${esc((c.textContent ?? '').trim())}</h3>`;
        }
      }
      return `<blockquote>${poem}</blockquote>`;
    }
    case 'image': {
      const data = images.get(hrefOf(el).replace(/^#/, ''));
      return data ? `<p><img src="${data}" /></p>` : '';
    }
    case 'empty-line':
      return '';
    case 'table': {
      const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      return t ? `<p>${esc(t)}</p>` : '';
    }
    case 'title':
      return `<h3>${esc((el.textContent ?? '').replace(/\s+/g, ' ').trim())}</h3>`;
    case 'section': {
      // 嵌套节：标题作 h3，内容平铺
      let out = '';
      let titleTaken = false;
      for (const n of kids(el)) {
        if (n.nodeType !== 1) continue;
        const c = n as Element;
        if (c.localName === 'title' && !titleTaken) {
          titleTaken = true;
          out += `<h3>${esc((c.textContent ?? '').replace(/\s+/g, ' ').trim())}</h3>`;
          continue;
        }
        out += blockHtml(c, images);
      }
      return out;
    }
    default:
      return inlineHtml(el, images);
  }
}

/** 章节内容：跳过首个 title（已作章名），其余块级转换 */
function sectionHtml(sec: Element, images: Map<string, string>): string {
  let out = '';
  let titleTaken = false;
  for (const n of kids(sec)) {
    if (n.nodeType !== 1) continue;
    const c = n as Element;
    if (c.localName === 'title' && !titleTaken) {
      titleTaken = true;
      continue;
    }
    out += blockHtml(c, images);
  }
  return out.trim();
}

export async function parseFb2(buf: ArrayBuffer, fallbackTitle: string): Promise<ParsedFb2> {
  let bytes = new Uint8Array(buf);
  // .fb2.zip：取包内首个 .fb2
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipBook(bytes);
    const key = Object.keys(files).find((k) => /\.fb2$/i.test(k) && !k.includes('__MACOSX'));
    if (!key) throw new Error('fb2.zip 中未找到 .fb2 文件');
    bytes = files[key];
  }

  const xml = decodeXml(bytes);
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    throw new Error('不是有效的 FB2 文件（XML 解析失败）');
  }
  if (doc.querySelector('parsererror')) throw new Error('不是有效的 FB2 文件（XML 格式错误）');
  const root = doc.documentElement;
  if (!root || (root.localName ?? '').toLowerCase() !== 'fictionbook') {
    throw new Error('不是有效的 FB2 文件');
  }

  // 元数据
  const titleEl = firstLocal(root, 'book-title');
  const title = (titleEl?.textContent ?? '').trim() || fallbackTitle;
  const authorEl = firstLocal(root, 'author');
  let author = '';
  if (authorEl) {
    const first = (firstLocal(authorEl, 'first-name')?.textContent ?? '').trim();
    const last = (firstLocal(authorEl, 'last-name')?.textContent ?? '').trim();
    const nick = (firstLocal(authorEl, 'nickname')?.textContent ?? '').trim();
    author = [last, first].filter(Boolean).join('') || nick;
  }

  // 图片表：binary id → data URL
  const images = new Map<string, string>();
  for (const b of byLocal(root, 'binary')) {
    const id = b.getAttribute('id') ?? '';
    const mime = b.getAttribute('content-type') || 'image/jpeg';
    const raw = (b.textContent ?? '').replace(/\s+/g, '');
    if (id && raw) images.set(id, `data:${mime};base64,${raw}`);
  }

  // 封面：coverpage/image → binary
  let cover: string | undefined;
  const coverImg = firstLocal(root, 'coverpage');
  if (coverImg) {
    const img = firstLocal(coverImg, 'image');
    const data = img ? images.get(hrefOf(img).replace(/^#/, '')) : undefined;
    if (data) cover = data;
  }

  // 正文：首个 body 的顶层 section 各成一章；无 section 则整本一章
  const bodies = byLocal(root, 'body');
  const body = bodies[0] ?? null;
  if (!body) throw new Error('FB2 解析失败：缺少正文 body');

  const chapters: ParsedChapter[] = [];
  const topSections = kids(body).filter((n) => n.nodeType === 1 && (n as Element).localName === 'section') as Element[];

  const pushChapter = (chapterTitle: string, html: string) => {
    const chars = html
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, '').length;
    if (!chars && !/<img/i.test(html)) return;
    chapters.push({ title: chapterTitle || `第 ${chapters.length + 1} 节`, html, chars: Math.max(1, chars) });
  };

  if (topSections.length > 0) {
    for (const sec of topSections) {
      const tEl = firstLocal(sec, 'title');
      const t = (tEl?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      pushChapter(t, sectionHtml(sec, images));
    }
  } else {
    let html = '';
    for (const n of kids(body)) {
      if (n.nodeType === 1) html += blockHtml(n as Element, images);
    }
    pushChapter(title, html.trim());
  }

  if (!chapters.length) throw new Error('FB2 解析失败：未找到正文内容');
  return { title, author, cover, chapters };
}
