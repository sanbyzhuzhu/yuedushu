import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { escapeHtml } from './importExtra';

/** PDF text order is best effort. Preserve line boundaries for columns/tables instead of inventing paragraphs. */
export function pdfTextLines(items: unknown[]): string[] {
  const lines: string[] = []; let line = '', previous: TextItem | undefined;
  const flush = () => { if (line.trim()) lines.push(line.trim()); line = ''; previous = undefined; };
  for (const value of items) {
    if (!value || typeof value !== 'object' || !('str' in value)) continue;
    const item = value as TextItem;
    if (typeof item.str !== 'string' || !Array.isArray(item.transform)) continue;
    if (previous) {
      const vertical = item.dir === 'ttb' || previous.dir === 'ttb';
      const fontSize = Math.max(1, Math.hypot(item.transform[2], item.transform[3]));
      const differentLine = vertical ? Math.abs(item.transform[4] - previous.transform[4]) > fontSize * .6 : Math.abs(item.transform[5] - previous.transform[5]) > fontSize * .6;
      if (differentLine) flush();
      else if (!vertical && line && item.str && !/\s$/.test(line) && !/^\s/.test(item.str)) {
        const gap = item.transform[4] - (previous.transform[4] + previous.width);
        // Avoid inserting spaces inside Chinese text; separate Latin words when PDF stores them apart.
        if (gap > fontSize * .18 && /[\p{L}\p{N}]$/u.test(line) && /^[\p{L}\p{N}]/u.test(item.str) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(line) && !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.str)) line += ' ';
      }
    }
    line += item.str;
    previous = item;
    if (item.hasEOL) flush();
  }
  flush(); return lines;
}

export async function reflowPdf(doc: PDFDocumentProxy, title: string, author: string, from: number, to: number, signal: AbortSignal, onProgress: (done: number, total: number) => void): Promise<{ file: File; emptyPages: number }> {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > doc.numPages || from > to || to - from >= 1000) throw new Error('请选择有效的页码范围，每次最多 1000 页');
  const permissions = await doc.getPermissions();
  // PDF.js PermissionFlag.COPY = 16. Null means no permission restrictions.
  if (permissions && !permissions.includes(16)) throw new Error('此 PDF 限制文字提取，请使用允许复制的文档');
  const parts: string[] = []; let chars = 0, emptyPages = 0;
  for (let n = from; n <= to; n++) {
    signal.throwIfAborted(); onProgress(n - from, to - from + 1);
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    signal.throwIfAborted();
    const lines = pdfTextLines(content.items);
    if (!lines.length) emptyPages++;
    chars += lines.join('').length;
    if (chars > 12 * 1024 * 1024) throw new Error('提取文字过多，请分段重排');
    parts.push(`<h2>原第 ${n} 页</h2>${lines.length ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('') : '<p>此页没有可提取的文字。图片内容请查看原 PDF。</p>'}`);
    // Yield for cancellation and painting even when PDF.js serves cached text synchronously.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  if (!chars) throw new Error('所选页没有可提取的文字，可能是扫描图片或缺少文字映射；本版不包含 OCR');
  onProgress(to - from + 1, to - from + 1);
  const bookTitle = `${title} · 文字重排${from !== 1 || to !== doc.numPages ? `（${from}–${to}页）` : ''}`;
  const html = `<html><head><title>${escapeHtml(bookTitle)}</title><meta name="author" content="${escapeHtml(author)}"></head><body>${parts.join('')}</body></html>`;
  return { file: new File([html], `${bookTitle}.html`, { type: 'text/html' }), emptyPages };
}
