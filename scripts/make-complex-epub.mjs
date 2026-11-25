/**
 * 构造一本"结构复杂"的测试 EPUB：blockquote / figure+图 / h2 / ul / hr 全上——
 * 这些元素的 UA margin 在竖排下会破坏"一行=一栏"的节距网格（漏列根因），
 * 用于验证竖排节距纯净化修复。
 */
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';

const mkdir = (p) => {
  try {
    mkdirSync(p, { recursive: true });
  } catch {}
};
mkdir('E:/Anti/yuedushu/samples');

// 1x1 红色 PNG（内联 figure 用）
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const ch = (title, paras) => `<html><head><meta charset="utf-8"/><title>${title}</title></head><body>
<h2>${title}</h2>
${paras}
</body></html>`;

const p = (t) => `<p>${t}</p>`;
const quote = (t) => `<blockquote><p>${t}</p></blockquote>`;
const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const fig = `<figure><img src="images/dot.png" alt="图"/><figcaption>插图题注</figcaption></figure>`;

const longText = (n, seed) => {
  const han = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国有虞陶唐吊民伐罪周发殷汤坐朝问道垂拱平章';
  let out = '';
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 31 + 7) % han.length;
    out += han[x];
    if (i % 17 === 16) out += '，';
    if (i % 53 === 52) out += '。';
  }
  return out;
};

const html = (t) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>${t}</title></head><body>`;

const chapters = [
  html('第一章 千字开篇') +
    `<h2>第一章 千字开篇</h2>` +
    p(`"天地玄黄，宇宙洪荒。"这是流传千年的蒙学开篇，四字一句，包罗万象。所谓"日月盈昃，辰宿列张"，讲的是天象运行之理。`) +
    quote(`"寒来暑往，秋收冬藏。"——此句出自《千字文》，历来为农家所重。`) +
    p(longText(600, 3)) +
    ul(['云腾致雨', '露结为霜', '金生丽水', '玉出昆冈']) +
    fig +
    p(`"海咸河淡，鳞潜羽翔。"自然万物，各得其所。` + longText(300, 11)) +
    `<hr/>` +
    p(longText(400, 21)) +
    `</body></html>`,
  html('第二章 龙师火帝') +
    `<h2>第二章 龙师火帝</h2>` +
    quote(`"龙师火帝，鸟官人皇。"上古之世，以德为号。`) +
    p(longText(700, 5) + `"始制文字，乃服衣裳。"仓颉造字，嫘祖制衣，文明肇始。`) +
    ul(['推位让国', '有虞陶唐', '吊民伐罪', '周发殷汤']) +
    p(longText(500, 17) + `到此一段，"坐朝问道，垂拱平章"乃是治世之象。`) +
    `</body></html>`,
  html('第三章 爱育黎首') +
    `<h2>第三章 爱育黎首</h2>` +
    p(longText(800, 9)) +
    quote(`"遐迩一体，率宾归王。"天下大同，此之谓也。`) +
    p(longText(600, 23)) +
    `</body></html>`,
];

const files = {
  mimetype: strToU8('application/epub+zip'),
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
  'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:complex-test</dc:identifier>
    <dc:title>千字文浅说</dc:title>
    <dc:creator>测试编纂</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/>
    <item id="dot" href="images/dot.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>`),
  'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body>
<nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章 千字开篇</a></li><li><a href="c2.xhtml">第二章 龙师火帝</a></li><li><a href="c3.xhtml">第三章 爱育黎首</a></li></ol></nav>
</body></html>`),
  'OEBPS/c1.xhtml': strToU8(chapters[0]),
  'OEBPS/c2.xhtml': strToU8(chapters[1]),
  'OEBPS/c3.xhtml': strToU8(chapters[2]),
  'OEBPS/images/dot.png': png,
};

const zip = zipSync(files, { level: 0 });
writeFileSync('E:/Anti/yuedushu/samples/千字文浅说-复杂结构.epub', zip);
console.log('written samples/千字文浅说-复杂结构.epub', zip.length, 'bytes');
