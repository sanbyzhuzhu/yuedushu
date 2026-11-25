/** MOBI/AZW3 解析（V0.0.9）：基于 foliate-js（MIT）的 mobi 解析器，
 *  输出归一化为章节化 HTML 流（复用 EPUB 的清洗与图片内联逻辑）。
 *  foliate-js 动态加载：仅在实际导入 MOBI 时拉取 */
import { unzlib } from 'fflate';
import { cleanDoc, toDataUrl, stripGutenbergBoilerplate, type ParsedChapter } from './epub';

export interface ParsedMobi {
  title: string;
  author: string;
  cover?: string;
  chapters: ParsedChapter[];
}

const MAX_IMG_BYTES = 3_000_000;

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return toDataUrl(new Uint8Array(buf), blob.type || 'image/jpeg');
}

/** MOBI 图片经 recindex 解析为 blob: URL；导入期统一转成 data URL 才能持久化 */
async function persistImages(doc: Document): Promise<void> {
  const imgs = [...doc.querySelectorAll('img, image')];
  await Promise.all(
    imgs.map(async (el) => {
      const src = el.getAttribute('src') || '';
      if (!src.startsWith('blob:')) return;
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        if (blob.size > MAX_IMG_BYTES) {
          el.remove();
          return;
        }
        el.setAttribute('src', await blobToDataUrl(blob));
      } catch {
        el.remove();
      }
    }),
  );
}

function firstHeading(doc: Document): string {
  const h = doc.querySelector('h1,h2,h3,h4');
  const t = (h?.textContent || '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 60) : '';
}

export async function parseMobi(buf: ArrayBuffer, fallbackTitle: string): Promise<ParsedMobi> {
  const file = new File([buf], 'book.mobi', { type: 'application/x-mobipocket-ebook' });
  const { MOBI, isMOBI } = await import('foliate-js/mobi.js');
  if (!(await isMOBI(file))) throw new Error('不是有效的 MOBI/AZW3 文件');

  const mobi = new MOBI({
    unzlib: (data: Uint8Array) =>
      new Promise<Uint8Array>((resolve, reject) =>
        unzlib(data, (err, out) => (err ? reject(err) : resolve(out))),
      ),
  });
  const book = await mobi.open(file);

  const meta = book.metadata;
  const title = (meta.title || fallbackTitle).trim() || fallbackTitle;
  const author = Array.isArray(meta.author) ? meta.author.join(', ') : meta.author || '';

  // TOC：filepos → 章节索引 → 标题
  const tocMap = new Map<number, string>();
  if (Array.isArray(book.toc)) {
    for (const item of book.toc) {
      try {
        const r = book.resolveHref?.(item.href);
        if (!r) continue;
        if (!tocMap.has(r.index) && item.label) tocMap.set(r.index, item.label.slice(0, 60));
      } catch {
        /* 忽略无法解析的目录项 */
      }
    }
  }

  const chapters: ParsedChapter[] = [];
  let index = 0;
  let seenText = false;
  for (const sec of book.sections) {
    try {
      const doc = await sec.createDocument();
      cleanDoc(doc);
      await persistImages(doc);
      const body = doc.body;
      if (!body) continue;
      const html = body.innerHTML.trim();
      const chars = (body.textContent || '').replace(/\s+/g, '').length;
      if (!chars && !/<img/i.test(html)) continue;
      // 跳过书首纯图页（封面已提取上书架）
      if (!seenText && chars <= 1 && /<img/i.test(html)) continue;
      seenText = true;
      index += 1;
      chapters.push({
        title: tocMap.get(sec.id) || firstHeading(doc) || `第 ${index} 节`,
        html,
        chars: Math.max(1, chars),
      });
    } catch {
      /* 跳过解析失败的节 */
    }
  }
  if (!chapters.length) throw new Error('MOBI 解析失败：未找到正文内容');

  let cover: string | undefined;
  try {
    const coverBlob = await book.getCover?.();
    if (coverBlob) cover = await blobToDataUrl(coverBlob);
  } catch {
    /* 无封面 */
  }

  return { title, author, cover, chapters: stripGutenbergBoilerplate(chapters) };
}
