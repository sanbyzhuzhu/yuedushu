import { expect, it } from 'vitest';
import { mdToHtml, parseFrontMatter, splitMdChapters } from '../src/engine/md';
it('识别一二级标题而不把代码块当目录', () => {
  const result = splitMdChapters('前言\n# 第一卷\n正文\n```md\n## 不是目录\n```\n## 小节\n尾声', '古籍');
  expect(result.chapters.map(c => [c.title, c.level])).toEqual([['前言', 1], ['第一卷', 1], ['小节', 2]]);
  expect(result.chapters[1].text).toContain('## 不是目录');
});
it('支持下划线式标题与格式化标题的纯文本名称', () => {
  expect(splitMdChapters('卷一\n====\n正文\n## **小节**\n末尾', '书').chapters.map(c => c.title)).toEqual(['卷一', '小节']);
});
it('解析 CRLF front matter，不把元数据算进正文', () => {
  expect(parseFrontMatter('---\r\ntitle: "古文"\r\nauthor: 佚名\r\n---\r\n正文')).toEqual({ attrs: { title: '古文', author: '佚名' }, body: '正文' });
});
it('Markdown 内嵌 HTML 不执行，危险协议不产生链接', () => {
  const html = mdToHtml('<script>alert(1)</script>\n\n[打开](javascript:alert(1))');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('href="javascript:');
});
