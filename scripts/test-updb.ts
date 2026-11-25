/** UPDB 解析冒烟测试（用真实样本 1010490774.updb） */
import { readFileSync, existsSync } from 'node:fs';
import { isUpdb, parseUpdb } from '../src/engine/updb';

const P = 'C:/Users/Administrator/Downloads/1010490774.updb';
if (!existsSync(P)) {
  console.log('样本不存在：', P);
  process.exit(0);
}

const buf = readFileSync(P);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string) => {
  if (c) {
    pass++;
    console.log('✓', n);
  } else {
    fail++;
    console.log('✗', n);
  }
};

ok(isUpdb(ab), '识别为 UPDB（MTIU 标识）');

const r = await parseUpdb(ab, '未命名');
console.log('\n书名:', r.title);
console.log('作者:', r.author || '(无)');
console.log('章节数:', r.chapters.length);
console.log('\n前 8 章：');
for (const c of r.chapters.slice(0, 8)) {
  console.log(`  [${c.title}] ${c.chars} 字  首段: ${c.html.replace(/<[^>]+>/g, '').slice(0, 46)}…`);
}

ok(r.title.length > 0 && r.title !== '未命名', '解析出书名');
ok(r.chapters.length >= 3, `章节数 >= 3（实际 ${r.chapters.length}）`);
ok(
  r.chapters.every((c) => c.html.startsWith('<p>')),
  '每章均为段落 HTML',
);
const total = r.chapters.reduce((a, c) => a + c.chars, 0);
ok(total > 10000, `正文总字数合理（${total}）`);
const garbled = r.chapters.filter((c) => /[\u0000-\u0008]|�/.test(c.html)).length;
ok(garbled === 0, '无乱码/替换字符');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
