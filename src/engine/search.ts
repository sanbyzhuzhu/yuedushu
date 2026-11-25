/** 书内全文搜索（V0.2.1）：遍历章节文本，返回片段结果（PDF 固定版式不参与） */
import type { Chapter } from './types';
import type { Quote } from './annotate';

export interface SearchResult {
  chapter: number;
  title: string;
  snippet: string;
  quote: Quote;
}

const textCache = new WeakMap<Chapter, string>();

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ');
}

export function searchBook(chapters: Chapter[], query: string, limit = 200): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const out: SearchResult[] = [];
  for (let i = 0; i < chapters.length && out.length < limit; i++) {
    let text = textCache.get(chapters[i]);
    if (text === undefined) { text = htmlToText(chapters[i].html); textCache.set(chapters[i], text); }
    const lower = text.toLowerCase();
    let idx = lower.indexOf(q.toLowerCase());
    while (idx >= 0 && out.length < limit) {
      const start = Math.max(0, idx - 16);
      const snippet =
        (start > 0 ? '…' : '') + text.slice(start, idx + q.length + 24).trim() + '…';
      const strip = (s: string) => s.replace(/\s/g, '');
      out.push({ chapter: i, title: chapters[i].title, snippet, quote: {
        exact: strip(text.slice(idx, idx + q.length)),
        prefix: strip(text.slice(0, idx)).slice(-24),
        suffix: strip(text.slice(idx + q.length)).slice(0, 24),
      } });
      idx = lower.indexOf(q.toLowerCase(), idx + q.length);
    }
  }
  return out;
}
