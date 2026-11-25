/** Markdown 解析：front matter → 按语法树切分一级、二级标题 → HTML
 *  安全基线：markdown-it html:false，原文内联 HTML 一律转义显示（后续接 DOMPurify 支持受信 EPUB 内联） */
import MarkdownIt from 'markdown-it';

const mdi = new MarkdownIt({ html: false, linkify: false, breaks: false, typographer: false });

export function parseFrontMatter(raw: string): { attrs: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { attrs: {}, body: raw };
  const attrs: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+)\s*:\s*(.+)$/.exec(line.trim());
    if (kv) attrs[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { attrs, body: raw.slice(m[0].length) };
}

export interface MdChapter {
  title: string;
  text: string;
  level?: number;
}

export function splitMdChapters(
  raw: string,
  fallbackTitle: string,
): { title: string; author: string; chapters: MdChapter[] } {
  const { attrs, body } = parseFrontMatter(raw);
  const title = attrs.title || fallbackTitle;
  const author = attrs.author || '';

  const lines = body.split(/\r\n|\r|\n/), tokens = mdi.parse(body, {});
  const headings: { line: number; title: string; level: number }[] = [];
  tokens.forEach((token, i) => {
    // Markdown parser excludes fenced code and recognizes Setext headings too.
    if (token.type !== 'heading_open' || !/^h[12]$/.test(token.tag) || token.level !== 0 || !token.map) return;
    const inline = tokens[i + 1];
    const plain = inline?.children?.map((child) => ['text', 'code_inline', 'image'].includes(child.type) ? child.content : child.type === 'softbreak' ? ' ' : '').join('') || inline?.content || title;
    headings.push({ line: token.map[0], title: plain, level: Number(token.tag[1]) });
  });
  const chapters: MdChapter[] = [];
  if (headings.length && lines.slice(0, headings[0].line).join('\n').trim()) chapters.push({ title: '前言', text: lines.slice(0, headings[0].line).join('\n'), level: 1 });
  headings.forEach((heading, i) => chapters.push({ title: heading.title, level: heading.level, text: lines.slice(heading.line, headings[i + 1]?.line).join('\n') }));
  return { title, author, chapters: chapters.length ? chapters : [{ title, text: body }] };
}

/** Build a view-only outline, including H2s in books imported by older releases. */
export function markdownOutline(chapters: { title: string; html: string; level?: number }[]) {
  return chapters.flatMap((chapter, index) => {
    const doc = new DOMParser().parseFromString(chapter.html, 'text/html');
    const headings = Array.from(doc.querySelectorAll('h1,h2'));
    const entries = [{ index, title: chapter.title, level: chapter.level || 1, heading: -1 }];
    headings.forEach((heading, n) => {
      const title = heading.textContent?.trim() || '';
      if (n === 0 && title === chapter.title) return;
      if (title) entries.push({ index, title, level: Number(heading.tagName[1]), heading: n });
    });
    return entries;
  });
}

export function mdToHtml(src: string): string {
  return mdi.render(src);
}
