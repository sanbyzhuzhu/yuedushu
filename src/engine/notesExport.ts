/** 读书笔记导出为 Markdown（V0.0.8）——"MD 进、MD 出"闭环 */
import type { Annotation, BookMeta } from './types';
import { saveExport } from './fileExport';

const COLOR_NAME: Record<string, string> = { red: '朱', green: '青', blue: '蓝', amber: '褐' };

function orderedHighlights(anns: Annotation[]): Annotation[] {
  return anns.filter((a) => a.kind === 'highlight')
    .sort((a, b) => a.chapter - b.chapter || a.createdAt - b.createdAt);
}

export function buildNotesMarkdown(
  book: BookMeta,
  anns: Annotation[],
  chapterTitles: string[],
): string {
  void book; // 朗读友好导出只包含选中的原文与用户写下的批注。
  const lines: string[] = [];
  let previousChapter = -1;
  for (const a of orderedHighlights(anns)) {
    if (a.chapter !== previousChapter) {
      if (lines.length) lines.push('');
      const title = chapterTitles[a.chapter]?.trim();
      // 有真实章节名时仅在章节开头出现一次；不生成“第 N 节”占位标题。
      if (title) lines.push(`## ${title}`, '');
      previousChapter = a.chapter;
    }
    lines.push(`> ${a.exact.trim()}`);
    if (a.note?.trim()) {
      if (lines[lines.length - 1] !== '') lines.push('');
      lines.push(a.note.trim());
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function downloadNotes(filename: string, md: string): Promise<string> {
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  return saveExport(blob, filename);
}

/** 纯文本导出（V0.3.1） */
export function buildNotesTxt(book: BookMeta, anns: Annotation[], chapterTitles: string[]): string {
  void book;
  const lines: string[] = [];
  let previousChapter = -1;
  for (const a of orderedHighlights(anns)) {
    if (a.chapter !== previousChapter) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      const title = chapterTitles[a.chapter]?.trim();
      if (title) lines.push(title, '');
      previousChapter = a.chapter;
    }
    lines.push(a.exact.trim());
    if (a.note?.trim()) {
      if (lines[lines.length - 1] !== '') lines.push('');
      lines.push(a.note.trim());
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

const csvCell = (v: string): string => `"${(v ?? '').replace(/"/g, '""')}"`;

/** CSV 导出（V0.3.1，带 BOM 可直接被 Excel/WPS 打开） */
export function buildNotesCsv(book: BookMeta, anns: Annotation[], chapterTitles: string[]): string {
  const rows: string[] = ['序号,类型,章节,引语,批注,颜色,创建时间'];
  const sorted = [...anns].sort((a, b) => a.chapter - b.chapter || a.createdAt - b.createdAt);
  sorted.forEach((a, i) => {
    rows.push(
      [
        String(i + 1),
        a.kind === 'bookmark' ? '书签' : a.note ? '批注' : '划线',
        chapterTitles[a.chapter] ?? `第 ${a.chapter + 1} 节`,
        a.exact,
        a.note,
        COLOR_NAME[a.color] ?? a.color,
        new Date(a.createdAt).toLocaleString('zh-CN'),
      ]
        .map(csvCell)
        .join(','),
    );
  });
  return '\uFEFF' + rows.join('\r\n');
}
