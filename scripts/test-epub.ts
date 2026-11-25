/** EPUB 解析器边界用例冒烟测试：esbuild 打包后 Node 运行（linkedom 提供 DOM） */
import { zipSync, strToU8 } from 'fflate';
import { DOMParser } from 'linkedom';
import { parseEpub } from '../src/engine/epub';

const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser = DOMParser;
g.document = { createElement: () => ({ getContext: () => null }) }; // 封面 canvas 桩

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ FAIL ${name}`);
  }
}

const XHTML = (title: string, paras: string[]) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h2>${title}</h2>${paras.map((p) => `<p>${p}</p>`).join('')}</body></html>`;

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="{OPF}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function opfOf(items: string[], spine: string[], title: string, author: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title><dc:creator>${author}</dc:creator>
    <dc:identifier id="id">test</dc:identifier>
  </metadata>
  <manifest>${items.join('')}</manifest>
  <spine>${spine.map((id) => `<itemref idref="${id}"/>`).join('')}</spine>
</package>`;
}

async function main() {
  // ---------- A：嵌套目录 + URL 编码 href + 空格文件名 + EPUB2 ncx + 封面 ----------
  console.log('A. 嵌套目录/URL编码/ncx/封面');
  {
    const zip = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(CONTAINER.replace('{OPF}', 'OEBPS/content.opf')),
      'OEBPS/content.opf': strToU8(
        opfOf(
          [
            `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
            `<item id="c1" href="text/chapter%201.xhtml" media-type="application/xhtml+xml"/>`,
            `<item id="c2" href="text/chapter%202.xhtml" media-type="application/xhtml+xml"/>`,
            `<item id="cv" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`,
          ],
          ['c1', 'c2'],
          '爱莲说集',
          '周敦颐',
        ),
      ),
      'OEBPS/toc.ncx': strToU8(`<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1"><navLabel><text>爱莲说</text></navLabel><content src="text/chapter%201.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>陋室铭</text></navLabel><content src="text/chapter%202.xhtml"/></navPoint>
  </navMap>
</ncx>`),
      'OEBPS/text/chapter 1.xhtml': strToU8(XHTML('爱莲说', ['水陆草木之花，可爱者甚蕃。', '予独爱莲之出淤泥而不染。'])),
      'OEBPS/text/chapter 2.xhtml': strToU8(XHTML('陋室铭', ['山不在高，有仙则名。', '斯是陋室，惟吾德馨。'])),
      'OEBPS/images/cover.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
    });
    const r = await parseEpub(zip.buffer as ArrayBuffer, 'fallback');
    ok(r.title === '爱莲说集', `书名=${r.title}`);
    ok(r.author === '周敦颐', `作者=${r.author}`);
    ok(r.chapters.length === 2, `章节数=${r.chapters.length}`);
    ok(r.chapters[0]?.title === '爱莲说', `章题1=${r.chapters[0]?.title}`);
    ok(r.chapters[1]?.title === '陋室铭', `章题2=${r.chapters[1]?.title}`);
    ok(r.chapters[0]?.html.includes('出淤泥而不染'), '正文含关键句');
  }

  // ---------- B：zip 与 OPF 路径大小写不一致 + manifest 缺 media-type ----------
  console.log('B. 大小写不一致 + 缺 media-type');
  {
    const zip = zipSync({
      'META-INF/container.xml': strToU8(CONTAINER.replace('{OPF}', 'content.opf')),
      'content.opf': strToU8(
        opfOf(
          [
            `<item id="c1" href="Text/Chapter1.XHTML"/>`,
            `<item id="c2" href="Text/Chapter2.XHTML"/>`,
          ],
          ['c1', 'c2'],
          '大小写测试',
          '',
        ),
      ),
      'text/chapter1.xhtml': strToU8(XHTML('桃花源记', ['晋太元中，武陵人捕鱼为业。'])),
      'text/chapter2.xhtml': strToU8(XHTML('小石潭记', ['从小丘西行百二十步。'])),
    });
    const r = await parseEpub(zip.buffer as ArrayBuffer, 'fallback');
    ok(r.chapters.length === 2, `章节数=${r.chapters.length}`);
    ok(r.chapters[0]?.title === '桃花源记', `首章题=${r.chapters[0]?.title}`);
  }

  // ---------- C：spine 为空 → manifest 兜底 ----------
  console.log('C. 空 spine → manifest 兜底');
  {
    const zip = zipSync({
      'META-INF/container.xml': strToU8(CONTAINER.replace('{OPF}', 'content.opf')),
      'content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>空spine</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine></spine>
</package>`),
      'nav.xhtml': strToU8(`<html><body><nav epub:type="toc"><a href="c1.xhtml">甲</a><a href="c2.xhtml">乙</a></nav></body></html>`),
      'c1.xhtml': strToU8(XHTML('岳阳楼记', ['庆历四年春，滕子京谪守巴陵郡。'])),
      'c2.xhtml': strToU8(XHTML('醉翁亭记', ['环滁皆山也。'])),
    });
    const r = await parseEpub(zip.buffer as ArrayBuffer, 'fallback');
    ok(r.chapters.length === 2, `章节数=${r.chapters.length}（nav 不入正文）`);
    ok(r.chapters[0]?.title === '甲', `首章题=${r.chapters[0]?.title}（nav 目录名优先）`);
  }

  // ---------- D：manifest 也不全 → 扫 zip 兜底；及彻底损坏的明确报错 ----------
  console.log('D. 空manifest兜底 + 损坏报错');
  {
    const zip = zipSync({
      'META-INF/container.xml': strToU8(CONTAINER.replace('{OPF}', 'content.opf')),
      'content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>散装</dc:title></metadata>
  <manifest></manifest>
  <spine></spine>
</package>`),
      'zz-last.xhtml': strToU8(XHTML('马说', ['世有伯乐，然后有千里马。'])),
      'aa-first.htm': strToU8(XHTML('师说', ['古之学者必有师。'])),
      'cover-page.xhtml': strToU8(XHTML('封面页', ['应被过滤'])),
    });
    const r = await parseEpub(zip.buffer as ArrayBuffer, 'fallback');
    ok(r.chapters.length === 2, `章节数=${r.chapters.length}（cover 页被排除、按路径排序）`);
    ok(r.chapters[0]?.title === '师说', `排序首章=${r.chapters[0]?.title}`);

    let threw = '';
    try {
      await parseEpub(new TextEncoder().encode('not a zip').buffer as ArrayBuffer, 'x');
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    ok(threw.includes('解压失败') || threw.includes('无效'), `损坏文件明确报错：${threw}`);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

void main();
