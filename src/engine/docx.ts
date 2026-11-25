/** DOCX（Word）解析（V0.0.6）：mammoth 浏览器版 → HTML → 按 H1/H2 切章 → 统一古典换肤
 *  mammoth 体积较大，动态加载：仅在实际导入 DOCX 时拉取 */
import type { ParsedChapter } from './epub';

export interface ParsedDocx {
  chapters: ParsedChapter[];
}

interface MammothLike {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
}

async function loadMammoth(): Promise<MammothLike> {
  const mod = await import('mammoth/mammoth.browser.min.js');
  return (mod.default ?? mod) as MammothLike;
}

export async function parseDocx(buf: ArrayBuffer, fallbackTitle: string): Promise<ParsedDocx> {
  const m = await loadMammoth();
  const res = await m.convertToHtml({ arrayBuffer: buf });
  const doc = new DOMParser().parseFromString(res.value || '', 'text/html');
  const body = doc.body;
  if (!body || !body.textContent?.trim()) throw new Error('DOCX 解析失败：未找到正文内容');

  const chapters: ParsedChapter[] = [];
  let cur: { title: string; parts: string[]; chars: number } | null = null;

  const flush = () => {
    if (!cur) return;
    const html = cur.parts.join('').trim();
    if (html) chapters.push({ title: cur.title, html, chars: Math.max(1, cur.chars) });
    cur = null;
  };

  for (const el of Array.from(body.children)) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1' || tag === 'h2') {
      flush();
      cur = {
        title: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名',
        parts: [el.outerHTML],
        chars: (el.textContent || '').replace(/\s+/g, '').length,
      };
      continue;
    }
    if (!cur) cur = { title: fallbackTitle, parts: [], chars: 0 };
    cur.parts.push(el.outerHTML);
    cur.chars += (el.textContent || '').replace(/\s+/g, '').length;
  }
  flush();

  return { chapters: chapters.length ? chapters : [{ title: fallbackTitle, html: body.innerHTML, chars: (body.textContent || '').replace(/\s+/g, '').length }] };
}
