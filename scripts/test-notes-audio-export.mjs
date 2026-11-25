import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5196, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5196');
  const result = await page.evaluate(async () => {
    const { buildNotesTxt, buildNotesMarkdown } = await import('/src/engine/notesExport.ts');
    const book = { id: 'b', title: '测试书', author: '作者', format: 'txt', size: 0, addedAt: 0, nodeId: null };
    const make = (id, kind, chapter, exact, note = '') => ({ id, bookId: 'b', kind, chapter, exact, note, prefix: '', suffix: '', color: 'red', createdAt: 1700000000000 });
    const anns = [make('h1', 'highlight', 0, '  山高月小，水落石出。  '), make('b1', 'bookmark', 0, 'ignored'), make('h2', 'highlight', 0, '前赤壁赋', '此处写下的批注。'), make('h3', 'highlight', 1, '清风徐来，水波不兴。')];
    return { txt: buildNotesTxt(book, anns, ['前赤壁赋', '后赤壁赋']), md: buildNotesMarkdown(book, anns, ['前赤壁赋', '后赤壁赋']) };
  });
  assert.equal(result.txt, '前赤壁赋\n\n山高月小，水落石出。\n\n前赤壁赋\n\n此处写下的批注。\n\n后赤壁赋\n\n清风徐来，水波不兴。');
  assert.ok(!/导出时间|共 \d+ 条|【\d+】|朱批|书签|作者：/.test(result.txt));
  assert.ok(result.md.includes('此处写下的批注。'));
  assert.ok(!/批注\*\*|朱批|导出时间|共 \d+ 条|书签/.test(result.md));
  console.log('PASS: TXT and Markdown contain only highlights and real notes, with one heading per chapter and no metadata or bookmarks');
} finally { await browser.close(); await server.close(); }
