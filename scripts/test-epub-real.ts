/** 真实世界 EPUB 导入冒烟测试：node 跑（linkedom 提供 DOM） */
import { readFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { parseEpub } from '../src/engine/epub';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser = DOMParser;
g.document = { createElement: () => ({ getContext: () => null }) };

const files = [
  'E:/Anti/yuedushu/.tmp/realbooks/pg24264-images.epub',
  'E:/Anti/yuedushu/.tmp/realbooks/pg2554-images.epub',
  'E:/Anti/yuedushu/.tmp/realbooks/pg16328-images.epub',
];

for (const f of files) {
  const name = f.split('/').pop();
  try {
    const buf = readFileSync(f);
    const t0 = Date.now();
    const r = await parseEpub(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, name);
    const ms = Date.now() - t0;
    const totalChars = r.chapters.reduce((a, c) => a + c.chars, 0);
    console.log(
      `✓ ${name}: 《${r.title}》${r.author} 章=${r.chapters.length} 字=${totalChars} 封面=${r.cover ? '有' : '无'} 耗时=${ms}ms`,
    );
    if (r.chapters.length === 0 || totalChars < 100) {
      console.error(`  ✗ FAIL: 章节或字数异常`);
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`✗ FAIL ${name}: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
