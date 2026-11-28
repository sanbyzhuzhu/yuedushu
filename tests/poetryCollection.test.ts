import { expect, it } from 'vitest';
import { parsePoetryCollection, poetryBook } from '../src/engine/poetryCollection';

it('兼容唐诗、宋词、诗经及包装对象，并统计不能读取的记录', () => {
  const result = parsePoetryCollection(JSON.stringify({ poems: [null, { title: '静夜思', author: '李白', paragraphs: ['床前明月光。'] }, { rhythmic: '如梦令', content: '常记溪亭日暮。\n沉醉不知归路。' }, { chapter: '国风', section: '周南', contents: ['关关雎鸠。'] }, { title: '作者资料', bio: '没有正文' }] }));
  expect(result.skipped).toBe(2);
  expect(result.poems.map(p => p.id)).toEqual([1, 2, 3]);
  expect(result.poems.map(p => p.title)).toEqual(['静夜思', '如梦令', '国风']);
  expect(result.poems[1].lines).toHaveLength(2);
  expect(parsePoetryCollection('{"metadata":{"author":"李白"}}').poems).toHaveLength(0);
});
it('合并只包含所选篇目，保留次序并清理 HTML 注入', async () => {
  const data = parsePoetryCollection(JSON.stringify([{ title: '第一首', paragraphs: ['<script>unsafe()</script>'] }, { title: '跳过的第二首', content: '不应入架' }, { title: '第三首', author: '作者', paragraphs: ['天地 & 山川'] }]));
  const file = await poetryBook('我的选集', [data.poems[0], data.poems[2]], 'https://raw.githubusercontent.com/demo/book/main/poems.json', new AbortController().signal);
  const html = await file.text();
  expect(html).toContain('第一首'); expect(html).toContain('第三首');
  expect(html).not.toContain('跳过的第二首'); expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;'); expect(html).toContain('天地 &amp; 山川');
  expect(file.name).toBe('我的选集.html');
});
it('空集、超量、损坏 JSON 和取消均不能产生半本书', async () => {
  expect(() => parsePoetryCollection('{bad')).toThrow('JSON');
  expect(() => parsePoetryCollection(JSON.stringify(Array(100001).fill(null)))).toThrow('100000');
  await expect(poetryBook('', [], '', new AbortController().signal)).rejects.toThrow('1–10000');
  const p = { id: 0, title: '诗', author: '', lines: ['正文'] };
  await expect(poetryBook('', Array(10001).fill(p), '', new AbortController().signal)).rejects.toThrow('1–10000');
  const controller = new AbortController(); controller.abort();
  await expect(poetryBook('', [p], '', controller.signal)).rejects.toThrow();
});
