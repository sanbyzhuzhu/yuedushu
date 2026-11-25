/** FB2 解析器冒烟测试（V0.3.2）：esbuild 打包后 Node 运行（linkedom 提供 DOM） */
import { zipSync, strToU8 } from 'fflate';
import { DOMParser } from 'linkedom';
import { parseFb2 } from '../src/engine/fb2';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser = DOMParser;

const FB2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <author><first-name>雪芹</first-name><last-name>曹</last-name></author>
      <book-title>紅樓夢測試</book-title>
      <coverpage><image l:href="#cover.png"/></coverpage>
    </title-info>
  </description>
  <body>
    <section>
      <title><p>第一回 甄士隱</p></title>
      <p>此開卷<emphasis>第一回</emphasis>也。</p>
      <poem><stanza><v>滿紙荒唐言</v><v>一把辛酸淚</v></stanza></poem>
    </section>
    <section>
      <title><p>第二回 賈夫人</p></title>
      <p>卻說黛玉同姐妹們至王夫人處。</p>
    </section>
  </body>
  <binary id="cover.png" content-type="image/png">iVBORw0KGgo=</binary>
</FictionBook>`;

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ FAIL ${name}`);
  }
}

async function main(): Promise<void> {
  const r = await parseFb2(strToU8(FB2).buffer as ArrayBuffer, 'fallback');

  ok(r.title === '紅樓夢測試', `书名=${r.title}`);
  ok(r.author === '曹雪芹', `作者=${r.author}`);
  ok(r.chapters.length === 2, `章节数=${r.chapters.length}`);
  ok(r.chapters[0]?.title === '第一回 甄士隱', `首章题=${r.chapters[0]?.title}`);
  ok((r.chapters[0]?.html ?? '').includes('<em>第一回</em>'), 'emphasis → em');
  ok(
    (r.chapters[0]?.html ?? '').includes('<blockquote>') && (r.chapters[0]?.html ?? '').includes('滿紙荒唐言'),
    'poem → blockquote',
  );
  ok(r.cover === 'data:image/png;base64,iVBORw0KGgo=', '封面 data URL');

  // .fb2.zip 自动解包
  const zip = zipSync({ 'book.fb2': strToU8(FB2) });
  const r2 = await parseFb2(zip.buffer as ArrayBuffer, 'fallback2');
  ok(r2.chapters.length === 2 && r2.title === '紅樓夢測試', 'fb2.zip 自动解包解析');

  // 非法输入 → 明确报错（不崩溃）
  let threw = '';
  try {
    await parseFb2(strToU8('这不是 FB2').buffer as ArrayBuffer, 'x');
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  ok(threw.length > 0, `非法输入明确报错：${threw.slice(0, 24)}`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

void main();
