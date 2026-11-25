/** TXT 解析：编码探测 → 章节切分 → 段落 HTML 化 */

export function decodeText(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(u8.subarray(3));
  }
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    /* 非 UTF-8，继续探测 */
  }
  try {
    return new TextDecoder('gb18030').decode(u8);
  } catch {
    /* 继续探测 */
  }
  try {
    return new TextDecoder('big5').decode(u8);
  } catch {
    /* 兜底 */
  }
  return new TextDecoder('utf-8').decode(u8);
}

const CH_RE =
  /^(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节卷回部集场]|序章|序言|自序|楔子|引子|前言|后记|尾声|附录|番外|Chapter\s+\d+).{0,30}$/;

export interface RawChapter {
  title: string;
  text: string;
}

export function splitTxtChapters(text: string, fallbackTitle: string): RawChapter[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: RawChapter[] = [];
  let cur: RawChapter | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 0 && t.length <= 40 && CH_RE.test(t)) {
      if (cur) out.push(cur);
      cur = { title: t, text: '' };
    } else {
      if (!cur) cur = { title: fallbackTitle, text: '' };
      cur.text += line + '\n';
    }
  }
  if (cur) out.push(cur);
  const filtered = out.filter((c) => c.text.trim().length > 0);
  return filtered.length > 0 ? filtered : [{ title: fallbackTitle, text }];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function txtToHtml(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join('');
}
