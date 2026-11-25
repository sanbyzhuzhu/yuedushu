/** Node 端 MOBI 解析链路冒烟测试：node scripts/test-mobi.mjs */
import { parseHTML, DOMParser, Node, NodeFilter } from 'linkedom';

const { document } = parseHTML('<html></html>');
globalThis.document = document;
globalThis.DOMParser = DOMParser;
globalThis.Node = Node;
globalThis.NodeFilter = NodeFilter;
class XMLSerializerStub {
  serializeToString(node) {
    return node?.outerHTML ?? String(node ?? '');
  }
}
globalThis.XMLSerializer = XMLSerializerStub;

import { readFileSync } from 'node:fs';
import { MOBI, isMOBI } from 'foliate-js/mobi.js';

const buf = readFileSync(new URL('../samples/古文三篇.mobi', import.meta.url));
const file = new File([buf], 'test.mobi');

console.log('isMOBI:', await isMOBI(file));
const mobi = new MOBI({ unzlib: async () => { throw new Error('not needed'); } });
const book = await mobi.open(file);
console.log('title :', book.metadata.title);
console.log('author:', book.metadata.author);
console.log('sections:', book.sections.length);
for (const s of book.sections) {
  let body = null;
  try {
    body = (await s.createDocument()).body;
  } catch {
    /* 空节：linkedom 对空文档访问 body 会抛异常，浏览器 DOM 不会 */
  }
  if (!body) {
    console.log(`  #${s.id} size=${s.size} (空节)`);
    continue;
  }
  const text = (body.textContent || '').replace(/\s+/g, '').slice(0, 24);
  console.log(`  #${s.id} size=${s.size} text="${text}…"`);
}
console.log('OK');
