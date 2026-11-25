/** 生成示例 MOBI（MOBI6 / 无压缩 / UTF-8），用于验证 MOBI 解析链路。
 *  运行：node scripts/make-sample-mobi.mjs  →  samples/古文三篇.mobi */
import { writeFileSync, mkdirSync } from 'node:fs';

const chapters = [
  {
    title: '岳阳楼记',
    author: '范仲淹',
    paras: [
      '庆历四年春，滕子京谪守巴陵郡。越明年，政通人和，百废具兴，乃重修岳阳楼，增其旧制，刻唐贤今人诗赋于其上，属予作文以记之。',
      '予观夫巴陵胜状，在洞庭一湖。衔远山，吞长江，浩浩汤汤，横无际涯，朝晖夕阴，气象万千，此则岳阳楼之大观也，前人之述备矣。',
      '嗟夫！予尝求古仁人之心，或异二者之为，何哉？不以物喜，不以己悲，居庙堂之高则忧其民，处江湖之远则忧其君。是进亦忧，退亦忧。然则何时而乐耶？其必曰"先天下之忧而忧，后天下之乐而乐"乎！噫！微斯人，吾谁与归？',
    ],
  },
  {
    title: '爱莲说',
    author: '周敦颐',
    paras: [
      '水陆草木之花，可爱者甚蕃。晋陶渊明独爱菊。自李唐来，世人甚爱牡丹。予独爱莲之出淤泥而不染，濯清涟而不妖，中通外直，不蔓不枝，香远益清，亭亭净植，可远观而不可亵玩焉。',
      '予谓菊，花之隐逸者也；牡丹，花之富贵者也；莲，花之君子者也。噫！菊之爱，陶后鲜有闻。莲之爱，同予者何人？牡丹之爱，宜乎众矣。',
    ],
  },
  {
    title: '兰亭集序',
    author: '王羲之',
    paras: [
      '永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭，修禊事也。群贤毕至，少长咸集。此地有崇山峻岭，茂林修竹，又有清流激湍，映带左右，引以为流觞曲水，列坐其次。',
      '是日也，天朗气清，惠风和畅。仰观宇宙之大，俯察品类之盛，所以游目骋怀，足以极视听之娱，信可乐也。',
    ],
  },
];

const html =
  `<html><head><guide><reference type="toc" title="目录" filepos="0"/></guide></head><body>` +
  chapters
    .map(
      (c) =>
        `<h1>${c.title}</h1><p>${c.author}</p>` +
        c.paras.map((p) => `<p>${p}</p>`).join('') +
        `<mbp:pagebreak/>`,
    )
    .join('') +
  `</body></html>`;

const textBytes = new TextEncoder().encode(html);
const RECORD_SIZE = 4096;
const numTextRecords = Math.ceil(textBytes.length / RECORD_SIZE);

// ---- record0：PalmDOC 头 + MOBI 头 + EXTH ----
const TITLE = '古文三篇';
const AUTHOR = '范仲淹 等';
const exthRecords = [];
const pushExth = (type, str) => {
  const data = new TextEncoder().encode(str);
  const rec = new Uint8Array(8 + data.length);
  new DataView(rec.buffer).setUint32(0, type);
  new DataView(rec.buffer).setUint32(4, 8 + data.length);
  rec.set(data, 8);
  exthRecords.push(rec);
};
pushExth(100, AUTHOR);
pushExth(503, TITLE);
const exthBodyLen = exthRecords.reduce((a, r) => a + r.length, 0);
const exthPad = (4 - (exthBodyLen % 4)) % 4;
const exthLen = 12 + exthBodyLen + exthPad;
const exth = new Uint8Array(exthLen);
{
  const dv = new DataView(exth.buffer);
  exth.set(new TextEncoder().encode('EXTH'), 0);
  dv.setUint32(4, exthLen);
  dv.setUint32(8, exthRecords.length);
  let off = 12;
  for (const r of exthRecords) {
    exth.set(r, off);
    off += r.length;
  }
}

const MOBI_HEADER_LEN = 248;
const titleBytes = new TextEncoder().encode(TITLE);
const record0Len = 16 + MOBI_HEADER_LEN + exthLen + titleBytes.length;
const r0 = new Uint8Array(record0Len);
const dv = new DataView(r0.buffer);

// PalmDOC header
dv.setUint16(0, 1); // compression: 1 = 无压缩
dv.setUint16(2, 0);
dv.setUint32(4, textBytes.length);
dv.setUint16(8, numTextRecords);
dv.setUint16(10, RECORD_SIZE);
dv.setUint16(12, 0); // encryption
// MOBI header
r0.set(new TextEncoder().encode('MOBI'), 16);
dv.setUint32(20, MOBI_HEADER_LEN);
dv.setUint32(24, 2); // mobi type: 2 = MOBI6
dv.setUint32(28, 65001); // UTF-8
dv.setUint32(32, 101); // uid
dv.setUint32(36, 6); // version
const titleOffset = 16 + MOBI_HEADER_LEN + exthLen;
dv.setUint32(84, titleOffset);
dv.setUint32(88, titleBytes.length);
dv.setUint32(108, 1 + numTextRecords); // resourceStart（无资源，指向末尾）
dv.setUint32(112, 0xffffffff); // huffcdic
dv.setUint32(116, 0);
dv.setUint32(128, 0x40); // exthFlag: bit6 = EXTH present
dv.setUint32(240, 0); // trailingFlags: 无
dv.setUint32(244, 0xffffffff); // indx: 无
r0.set(exth, 16 + MOBI_HEADER_LEN);
r0.set(titleBytes, titleOffset);

// ---- 文本记录 ----
const textRecords = [];
for (let i = 0; i < numTextRecords; i++) {
  textRecords.push(textBytes.subarray(i * RECORD_SIZE, (i + 1) * RECORD_SIZE));
}

// ---- PDB 容器 ----
const allRecords = [r0, ...textRecords];
const numRecords = allRecords.length;
const headerLen = 78 + numRecords * 8 + 2;
const out = new Uint8Array(headerLen + allRecords.reduce((a, r) => a + r.length, 0));
const odv = new DataView(out.buffer);
{
  const name = new TextEncoder().encode(TITLE.slice(0, 31));
  out.set(name, 0);
  out.set(new TextEncoder().encode('BOOK'), 60);
  out.set(new TextEncoder().encode('MOBI'), 64);
  odv.setUint32(76 + numRecords * 8, 0); // nextRecordListID 后的 extra？实际 76.. 为记录表
  // 记录表
  let recOff = headerLen;
  for (let i = 0; i < numRecords; i++) {
    odv.setUint32(78 + i * 8, recOff);
    recOff += allRecords[i].length;
  }
  odv.setUint16(78 + numRecords * 8, 0); // gap to 2-byte data end（合法填充）
}
// 修正：numRecords 位置
odv.setUint16(76, numRecords);

let pos = headerLen;
for (const r of allRecords) {
  out.set(r, pos);
  pos += r.length;
}

mkdirSync(new URL('../samples', import.meta.url), { recursive: true });
const outFile = new URL('../samples/古文三篇.mobi', import.meta.url);
writeFileSync(outFile, out);
console.log('已生成', decodeURIComponent(outFile.pathname), out.length, 'bytes,', numRecords, 'records');
