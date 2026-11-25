/** EPUB 解析器（V0.0.5）
 *  思路：解压 → container.xml → OPF（元数据/manifest/spine）→ TOC 标题（EPUB3 nav / EPUB2 ncx）
 *  → 逐 spine 项解析 XHTML，清洗脚本与样式、图片内联为 data URL → 归一化为章节化 HTML 流。
 *  原始 epub 文件另行存档（kv），供未来 foliate-js 升级与云同步使用。 */
import { unzipBook, ArchiveLimitError } from './archive';

export interface ParsedChapter {
  title: string;
  html: string;
  chars: number;
}

export interface ParsedEpub {
  title: string;
  author: string;
  cover?: string;
  chapters: ParsedChapter[];
}

const IMG_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

const MAX_IMG_BYTES = 3_000_000;

function extOf(p: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return m ? m[1].toLowerCase() : '';
}

function mimeOf(p: string): string {
  return IMG_MIME[extOf(p)] || 'application/octet-stream';
}

function decode(bytes: Uint8Array): string {
  // 去除 BOM，避免 XML/HTML 解析器在部分 WebView 上首标签识别失败
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

/** 真实世界 EPUB 的 zip 内路径大小写/编码经常与 OPF 声明不一致，构建宽松索引兜底 */
function buildFileIndex(files: Record<string, Uint8Array>): Map<string, string> {
  const idx = new Map<string, string>();
  for (const key of Object.keys(files)) {
    const norm = decodeURIComponent(key.replace(/\\/g, '/')).toLowerCase();
    if (!idx.has(norm)) idx.set(norm, key);
  }
  return idx;
}

function lookupFile(
  files: Record<string, Uint8Array>,
  index: Map<string, string>,
  path: string,
): Uint8Array | undefined {
  if (!path) return undefined;
  if (files[path]) return files[path];
  const dec = decodeURIComponent(path.replace(/\\/g, '/'));
  if (files[dec]) return files[dec];
  const hit = index.get(dec.toLowerCase());
  return hit ? files[hit] : undefined;
}

/** media-type 缺失/不规范时按扩展名推断 */
function inferHtmlMime(href: string, mime: string): string {
  if (mime) return mime;
  const ext = extOf(href);
  if (ext === 'xhtml' || ext === 'html' || ext === 'htm') return 'application/xhtml+xml';
  return '';
}

/** 相对路径 → zip 内规范路径（去锚点、处理 ./ ../ 与 URL 编码） */
export function normPath(baseDir: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0].trim());
  if (!clean || /^[a-z]+:/i.test(clean)) return clean;
  const parts = (baseDir ? baseDir.split('/') : []).concat(clean.split('/'));
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function dirOf(p: string): string {
  return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export { toDataUrl };

async function toCoverDataUrl(bytes: Uint8Array, mime: string): Promise<string | undefined> {
  try {
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }));
    const img = await Promise.race([
      new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      }),
      // 封面加载 3 秒超时：真实世界 EPUB 的封面可能是无法解码的图，绝不挂起导入
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('cover load timeout')), 3000)),
    ]);
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty cover');
    const max = 320;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return undefined;
  }
}

/** 清洗：去脚本/事件属性/链接跳转。
 *  keepCss=false（默认统一古典换肤）：连 style 标签与 style/class 属性一并去掉；
 *  keepCss=true（保留原书排版）：保留内嵌 CSS 与 class，让原书版式生效。
 *  两种模式都剔除脚本、外链资源与危险属性。 */
export function cleanDoc(doc: Document, keepCss = false): void {
  doc.querySelectorAll('script,iframe,object,embed,link,meta,base').forEach((el) => el.remove());
  if (!keepCss) {
    doc.querySelectorAll('style').forEach((el) => el.remove());
  }
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const isStyleAttr = name === 'style';
      const isClassAttr = name === 'class';
      const drop =
        name.startsWith('on') ||
        (name === 'href' && el.tagName === 'A') ||
        (!keepCss && (isStyleAttr || isClassAttr));
      if (drop) el.removeAttribute(attr.name);
    }
  });
}

function inlineImages(
  doc: Document,
  files: Record<string, Uint8Array>,
  index: Map<string, string>,
  baseDir: string,
): void {
  doc.querySelectorAll('img, image').forEach((el) => {
    const raw = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href') || '';
    if (!raw || /^(data|https?):/i.test(raw)) return;
    const path = normPath(baseDir, raw);
    const bytes = lookupFile(files, index, path);
    if (!bytes || bytes.length > MAX_IMG_BYTES) {
      el.remove();
      return;
    }
    el.setAttribute('src', toDataUrl(bytes, mimeOf(path)));
    el.removeAttribute('xlink:href');
  });
}

function firstHeading(doc: Document): string {
  const h = doc.querySelector('h1,h2,h3,h4');
  const t = (h?.textContent || '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 60) : '';
}

/** 剥离古登堡版权套话（*** START/END OF ... PROJECT GUTENBERG EBOOK ***）：
 *  竖排下满页侧躺英文全在这几页，观感极差。无标记的书原样返回。 */
export function stripGutenbergBoilerplate(chapters: ParsedChapter[]): ParsedChapter[] {
  const START = /\*{3,}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*?\*{3,}/i;
  const END = /\*{3,}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*?\*{3,}/i;
  const plain = (html: string) => html.replace(/<[^>]+>/g, '');
  const out = chapters.map((c) => ({ ...c }));

  // 找 START：其前所有章（书名/许可页）删除，所在章截去前半
  for (let i = 0; i < out.length; i++) {
    const m = START.exec(out[i].html);
    if (m) {
      const html = out[i].html.slice(m.index + m[0].length);
      let title = out[i].title;
      // 章题若来自套话页（如 "The Project Gutenberg eBook of ..."），用剩余内容的首个标题替换
      if (/gutenberg/i.test(title)) {
        const h = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html);
        title = h ? h[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      }
      out[i] = {
        ...out[i],
        title,
        html,
        chars: plain(html).replace(/\s+/g, '').length,
      };
      out.splice(0, i);
      break;
    }
  }

  // 找 END：所在章截去后半，其后所有章（License/捐赠页）删除
  for (let i = out.length - 1; i >= 0; i--) {
    const m = END.exec(out[i].html);
    if (m) {
      const html = out[i].html.slice(0, m.index);
      out[i] = { ...out[i], html, chars: plain(html).replace(/\s+/g, '').length };
      out.length = i + 1;
      break;
    }
  }

  const kept = out.filter((c) => c.chars > 0 || /<img/i.test(c.html));
  return kept.length ? kept : chapters;
}

/** TOC 标题映射：EPUB3 nav.xhtml / EPUB2 toc.ncx → 规范路径 → 标题 */
function buildTocMap(
  opf: Document,
  manifest: Map<string, { href: string; mime: string; props: string }>,
  opfDir: string,
  files: Record<string, Uint8Array>,
  index: Map<string, string>,
): Map<string, string> {
  const toc = new Map<string, string>();
  const readEntry = (item: { href: string }): string | null => {
    const path = normPath(opfDir, item.href);
    const bytes = lookupFile(files, index, path);
    return bytes ? decode(bytes) : null;
  };

  const navItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'));
  if (navItem) {
    const raw = readEntry(navItem);
    if (raw) {
      const navDir = dirOf(normPath(opfDir, navItem.href));
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const navs = [...doc.querySelectorAll('nav')];
      const nav = navs.find((n) => n.getAttribute('epub:type') === 'toc') ?? navs[0];
      nav?.querySelectorAll('a[href]').forEach((a) => {
        const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
        const path = normPath(navDir, a.getAttribute('href') || '');
        if (label && path) toc.set(path, label.slice(0, 60));
      });
    }
  }

  if (toc.size === 0) {
    const ncxItem =
      [...manifest.values()].find((m) => m.mime === 'application/x-dtbncx+xml') ?? undefined;
    if (ncxItem) {
      const raw = readEntry(ncxItem);
      if (raw) {
        const ncxDir = dirOf(normPath(opfDir, ncxItem.href));
        const xml = new DOMParser().parseFromString(raw, 'text/xml');
        xml.querySelectorAll('navPoint').forEach((np) => {
          const label = (np.getElementsByTagName('text')[0]?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
          const src = np.getElementsByTagName('content')[0]?.getAttribute('src') || '';
          const path = normPath(ncxDir, src);
          if (label && path) toc.set(path, label.slice(0, 60));
        });
      }
    }
  }
  return toc;
}

function pickMetaText(opf: Document, local: string): string {
  const dc = opf.getElementsByTagName(`dc:${local}`)[0];
  if (dc?.textContent) return dc.textContent.trim();
  for (const el of Array.from(opf.getElementsByTagName('*'))) {
    if (el.localName === local && el.namespaceURI?.includes('dc')) return (el.textContent || '').trim();
  }
  return '';
}

export async function parseEpub(
  buf: ArrayBuffer,
  fallbackTitle: string,
  keepCss = false,
): Promise<ParsedEpub> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipBook(new Uint8Array(buf));
  } catch (e) {
    if (e instanceof ArchiveLimitError) throw e;
    throw new Error('EPUB 解压失败：文件可能已损坏或不是有效的 EPUB');
  }
  const index = buildFileIndex(files);

  if (!lookupFile(files, index, 'META-INF/container.xml')) {
    throw new Error('无效的 EPUB：缺少 container.xml（请确认文件为 .epub 而非改名的其他格式）');
  }
  if (lookupFile(files, index, 'META-INF/encryption.xml')) {
    throw new Error('该 EPUB 已加密（DRM 保护），无法导入');
  }

  const container = new DOMParser().parseFromString(
    decode(lookupFile(files, index, 'META-INF/container.xml')!),
    'text/xml',
  );
  const opfRef =
    container.querySelector('rootfile')?.getAttribute('full-path') ||
    Object.keys(files).find((f) => f.toLowerCase().endsWith('.opf'));
  if (!opfRef) throw new Error('无效的 EPUB：缺少 OPF 描述文件');

  const opfPath = decodeURIComponent(opfRef);
  const opfDir = dirOf(opfPath);
  const opfBytes = lookupFile(files, index, opfPath);
  if (!opfBytes) throw new Error('无效的 EPUB：OPF 文件缺失');
  const opf = new DOMParser().parseFromString(decode(opfBytes), 'text/xml');

  const title = pickMetaText(opf, 'title') || fallbackTitle;
  const author = pickMetaText(opf, 'creator');

  const manifest = new Map<string, { href: string; mime: string; props: string }>();
  opf.querySelectorAll('manifest > item').forEach((it) => {
    const id = it.getAttribute('id') || '';
    if (id) {
      const href = it.getAttribute('href') || '';
      manifest.set(id, {
        href,
        mime: inferHtmlMime(href, it.getAttribute('media-type') || ''),
        props: it.getAttribute('properties') || '',
      });
    }
  });

  const spineIds: string[] = [];
  opf.querySelectorAll('spine > itemref').forEach((ir) => {
    const idref = ir.getAttribute('idref');
    if (idref) spineIds.push(idref);
  });

  const toc = buildTocMap(opf, manifest, opfDir, files, index);

  const parseChapter = (path: string): (ParsedChapter & { heading: string }) | null => {
    try {
      const bytes = lookupFile(files, index, path);
      if (!bytes) return null;
      const doc = new DOMParser().parseFromString(decode(bytes), 'text/html');
      cleanDoc(doc, keepCss);
      inlineImages(doc, files, index, dirOf(path));
      const body = doc.body;
      if (!body) return null;
      // 保留原书排版时：把章节内嵌 CSS（原在 <head>）随正文一起带出
      let html = body.innerHTML.trim();
      if (keepCss) {
        const css = Array.from(doc.querySelectorAll('style'))
          .map((s) => s.textContent || '')
          .join('\n')
          .trim();
        if (css) html = `<style>${css}</style>${html}`;
      }
      const chars = (body.textContent || '').replace(/\s+/g, '').length;
      if (!chars && !/<img/i.test(html)) return null;
      return {
        title: '',
        heading: firstHeading(doc),
        html,
        chars: Math.max(1, chars),
      };
    } catch {
      return null; // 单章损坏跳过，不拖垮整本
    }
  };

  const chapters: ParsedChapter[] = [];
  let seenText = false;
  const addParsed = (path: string) => {
    const c = parseChapter(path);
    if (!c) return;
    // 跳过书首纯图页（封面已提取上书架，留着只会得到一页空白）
    if (!seenText && c.chars <= 1 && /<img/i.test(c.html)) return;
    seenText = true;
    chapters.push({
      title: toc.get(path) || c.heading || `第 ${chapters.length + 1} 节`,
      html: c.html,
      chars: c.chars,
    });
  };

  // 主路径：按 spine 顺序
  for (const idref of spineIds) {
    const item = manifest.get(idref);
    if (!item) continue;
    if (item.props.split(/\s+/).includes('nav')) continue; // 目录页不入正文
    if (!/xhtml|html/.test(item.mime)) continue;
    addParsed(normPath(opfDir, item.href));
  }

  // 兜底 1：spine 缺失/畸形 → 按 manifest 顺序取全部 HTML 文档
  if (!chapters.length) {
    for (const item of manifest.values()) {
      if (item.props.split(/\s+/).includes('nav')) continue;
      if (!/xhtml|html/.test(item.mime)) continue;
      addParsed(normPath(opfDir, item.href));
    }
  }

  // 兜底 2：manifest 也不全 → 扫 zip 里全部网页文件（按路径排序保持稳定顺序）
  if (!chapters.length) {
    const htmlKeys = Object.keys(files)
      .filter((k) => /\.(xhtml|html|htm)$/i.test(k))
      .filter((k) => !/(nav|toc|ncx|cover)/i.test(k))
      .sort();
    for (const k of htmlKeys) addParsed(k);
  }

  if (!chapters.length) {
    throw new Error('EPUB 解析失败：未在其中找到任何正文内容，文件可能已损坏');
  }

  // 封面：EPUB3 properties → EPUB2 meta[name=cover] → 文件名含 cover 的图片
  let cover: string | undefined;
  const propCover = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('cover-image'));
  const metaCoverId = opf.querySelector('metadata > meta[name="cover"]')?.getAttribute('content') || '';
  const metaCover = manifest.get(metaCoverId);
  const nameCover = [...manifest.values()].find(
    (m) => m.mime.startsWith('image/') && /cover/i.test(m.href),
  );
  const cand = propCover ?? (metaCover?.mime.startsWith('image/') ? metaCover : nameCover);
  if (cand) {
    const p = normPath(opfDir, cand.href);
    const bytes = lookupFile(files, index, p);
    if (bytes) cover = await toCoverDataUrl(bytes, mimeOf(p));
  }

  return { title, author, cover, chapters: stripGutenbergBoilerplate(chapters) };
}
