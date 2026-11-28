import { escapeHtml } from './importExtra';

export const MAX_POETRY_ITEMS = 100000;
export const MAX_POETRY_MERGE = 10000;
export interface Poem { id: number; title: string; author: string; lines: string[] }
export interface PoetryCollection { poems: Poem[]; skipped: number }
export function parsePoetryCollection(text: string): PoetryCollection {
  let data: any;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('文件不是有效的 JSON，可下载原始文件后检查'); }
  const records = Array.isArray(data) ? data : Array.isArray(data?.poems) ? data.poems : Array.isArray(data?.chapters) ? data.chapters : Array.isArray(data?.data) ? data.data : [data];
  if (records.length > MAX_POETRY_ITEMS) throw new Error('JSON 超过 100000 条，请下载原始文件或选择更小的分卷');
  const poems: Poem[] = []; let skipped = 0;
  for (let id = 0; id < records.length; id++) {
    const p = records[id];
    if (!p || typeof p !== 'object' || Array.isArray(p)) { skipped++; continue; }
    const content = p.paragraphs ?? p.content ?? p.contents;
    const lines = typeof content === 'string' ? content.split(/\r?\n/) : Array.isArray(content) ? content : [];
    if (!lines.length || lines.some((v: unknown) => typeof v !== 'string') || !lines.some((v: string) => v.trim())) { skipped++; continue; }
    const title = [p.title, p.rhythmic, p.chapter, p.section, p.name].find(v => typeof v === 'string' && v.trim());
    poems.push({ id, title: title?.trim() || `第 ${id + 1} 篇`, author: typeof p.author === 'string' ? p.author : '', lines });
  }
  return { poems, skipped };
}
export function poemHtml(poem: Poem) {
  return '<h2>' + escapeHtml(poem.title) + '</h2>' + (poem.author ? '<p>' + escapeHtml(poem.author) + '</p>' : '') + poem.lines.map(line => '<p>' + escapeHtml(line) + '</p>').join('');
}
export async function poetryBook(title: string, poems: Poem[], sourceUrl: string, signal: AbortSignal): Promise<File> {
  if (!poems.length || poems.length > MAX_POETRY_MERGE) throw new Error('每本选集请选择 1–10000 篇，更多诗词可分批入架或下载原始 JSON');
  const parts: string[] = []; let bytes = 0;
  for (let start = 0; start < poems.length; start += 100) {
    signal.throwIfAborted();
    for (const poem of poems.slice(start, start + 100)) {
      const html = poemHtml(poem); bytes += new TextEncoder().encode(html).length;
      if (bytes > 256 * 1024 * 1024) throw new Error('选集正文超过 256 MiB，请减少所选篇数');
      parts.push(html);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  const name = title.trim() || '诗词选集';
  return new File(['<!doctype html><html><head><meta charset="utf-8"><title>', escapeHtml(name), '</title></head><body>', ...parts, '<p>来源：', escapeHtml(sourceUrl), '</p></body></html>'], name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 150) + '.html', { type: 'text/html' });
}
