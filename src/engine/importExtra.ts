/** 轻量可重排导入：复用已有 ZIP/XML 能力，不捆绑字体或版式渲染器。 */
import { unzipSync } from 'fflate';
import { toDataUrl } from './epub';
import type { ParsedEpub } from './epub';
import { decodeText } from './txt';

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const all = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
const first = (node: Document | Element, name: string) => all(node, name)[0];
function xml(bytes: Uint8Array): Document {
  const text = decodeText(bytes.slice().buffer as ArrayBuffer);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持带实体定义的 XML');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('文档 XML 格式错误');
  return doc;
}
function unpack(buf: ArrayBuffer) {
  let total = 0;
  return unzipSync(new Uint8Array(buf), { filter: (entry) => {
    total += entry.originalSize;
    if (entry.originalSize > 40 * 1024 * 1024 || total > 160 * 1024 * 1024) throw new Error('文档解压后过大，请先拆分再导入');
    return !/\.(?:ttf|otf|woff2?|ttc)$/i.test(entry.name);
  } });
}
function resolve(base: string, href: string) {
  const normalized = href.replace(/\\/g, '/');
  if (/^[a-z]+:/i.test(normalized)) throw new Error('不支持文档外部资源');
  const out: string[] = [];
  for (const part of (normalized.startsWith('/') ? normalized : base.slice(0, base.lastIndexOf('/') + 1) + normalized).split('/')) {
    if (part === '..') { if (!out.length) throw new Error('文档路径越界'); out.pop(); }
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}
function image(bytes?: Uint8Array): string {
  if (!bytes || bytes.length > 8 * 1024 * 1024) return '';
  const mime = bytes[0] === 137 && bytes[1] === 80 ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : '';
  return mime ? `<p><img src="${toDataUrl(bytes, mime)}" /></p>` : '';
}

/** 白名单重建节点，网页脚本、表单、远程资源和样式都不进入阅读页。 */
export function parseHtml(text: string, title: string): ParsedEpub {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const result: ParsedEpub = { title: doc.title.trim() || title, author: doc.querySelector('meta[name="author"]')?.getAttribute('content') || '', chapters: [] };
  const skip = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'BUTTON', 'INPUT', 'VIDEO', 'AUDIO', 'NOSCRIPT', 'TEMPLATE', 'NAV']);
  const tags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'PRE', 'BR', 'HR', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'B', 'I', 'TABLE', 'TR', 'TD', 'TH']);
  function clean(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '');
    if (!(node instanceof Element) || skip.has(node.tagName)) return '';
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      return /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src) && src.length < 12 * 1024 * 1024 ? `<img src="${src}" />` : '';
    }
    const body = Array.from(node.childNodes).map(clean).join('');
    const tag = node.tagName.toLowerCase();
    return tags.has(node.tagName) ? `<${tag}>${body}</${tag}>` : body;
  }
  // Flatten containers around headings so exported documents retain chapter navigation.
  const safe = new DOMParser().parseFromString(clean(doc.body), 'text/html');
  let current = { title: '正文', html: '', chars: 0 };
  const flush = () => { if (current.html.trim()) result.chapters.push(current); };
  function walk(node: Node) {
    if (node instanceof Element && /^(H1|H2)$/.test(node.tagName)) {
      flush(); current = { title: node.textContent?.trim() || '正文', html: node.outerHTML, chars: node.textContent?.length ?? 0 };
    } else if (node instanceof Element && node.querySelector('h1,h2')) Array.from(node.childNodes).forEach(walk);
    else { current.html += node instanceof Element ? node.outerHTML : escapeHtml(node.textContent ?? ''); current.chars += node.textContent?.length ?? 0; }
  }
  Array.from(safe.body.childNodes).forEach(walk); flush();
  if (!result.chapters.some((c) => c.chars || c.html.includes('<img'))) throw new Error('没有可读取的正文');
  return result;
}

export function parseOdt(buf: ArrayBuffer, title: string): ParsedEpub {
  const files = unpack(buf);
  if (!files['content.xml']) throw new Error('不是有效的 ODT 文档');
  const doc = xml(files['content.xml']);
  const body = first(doc, 'text');
  if (!body) throw new Error('ODT 没有正文');
  function convert(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '');
    if (!(node instanceof Element)) return '';
    const content = () => Array.from(node.childNodes).map(convert).join('');
    switch (node.localName) {
      case 'image': return image(files[resolve('content.xml', node.getAttribute('xlink:href') ?? '')]);
      case 'h': return `<h2>${content()}</h2>`;
      case 'p': return `<p>${content()}</p>`;
      case 'line-break': return '<br />';
      case 's': return ' '.repeat(Math.min(100, Math.max(1, Number(node.getAttribute('text:c')) || 1)));
      case 'tab': return '　';
      case 'annotation': case 'tracked-changes': case 'script': return '';
      default: return content();
    }
  }
  const parsed = parseHtml(convert(body), title);
  if (files['meta.xml']) { const meta = xml(files['meta.xml']); parsed.title = first(meta, 'title')?.textContent?.trim() || title; parsed.author = first(meta, 'creator')?.textContent?.trim() || ''; }
  return parsed;
}

export function parseOfd(buf: ArrayBuffer, title: string): ParsedEpub {
  const files = unpack(buf);
  const read = (path: string) => { if (!files[path]) throw new Error(`OFD 缺少文件：${path}`); return xml(files[path]); };
  const root = read('OFD.xml');
  const result: ParsedEpub = { title: first(root, 'Title')?.textContent?.trim() || title, author: first(root, 'Author')?.textContent?.trim() || '', chapters: [] };
  for (const body of all(root, 'DocBody')) {
    const docPath = resolve('OFD.xml', first(body, 'DocRoot')?.textContent?.trim() || '');
    const doc = read(docPath);
    const resources = new Map<string, string>();
    for (const ref of [...all(doc, 'PublicRes'), ...all(doc, 'DocumentRes')]) {
      const path = resolve(docPath, ref.textContent?.trim() || ''); const res = read(path);
      for (const media of all(res, 'MultiMedia')) resources.set(media.getAttribute('ID') || '', resolve(path, (res.documentElement.getAttribute('BaseLoc') || '.') + '/' + (first(media, 'MediaFile')?.textContent?.trim() || '')));
    }
    const templates = new Map(all(doc, 'TemplatePage').map((el) => [el.getAttribute('ID'), resolve(docPath, el.getAttribute('BaseLoc') || '')]));
    for (const entry of all(doc, 'Pages').flatMap((el) => Array.from(el.children).filter((c) => c.localName === 'Page'))) {
      const pg = read(resolve(docPath, entry.getAttribute('BaseLoc') || ''));
      const layers = [pg, ...all(pg, 'Template').flatMap((el) => { const path = templates.get(el.getAttribute('TemplateID')); return path ? [read(path)] : []; })];
      const fragments: { x: number; y: number; text: string; vertical: boolean }[] = [];
      for (const obj of layers.flatMap((l) => all(l, 'TextObject'))) {
        const b = (obj.getAttribute('Boundary') || '0 0 0 0').trim().split(/\s+/).map(Number);
        const m = (obj.getAttribute('CTM') || '1 0 0 1 0 0').trim().split(/\s+/).map(Number);
        let x = 0, y = 0;
        const delta = (value: string | null) => {
          const tokens = (value || '').trim().split(/\s+/); const out: number[] = [];
          for (let i = 0; i < tokens.length; i++) if (tokens[i]) {
            let count = 1;
            if (tokens[i] === 'g') { count = Number(tokens[++i]); i++; }
            const step = Number(tokens[i]);
            if (!Number.isInteger(count) || count < 0 || count > 100000 || !Number.isFinite(step) || out.length + count > 100000) throw new Error('OFD 字距数据无效');
            for (let n = 0; n < count; n++) out.push(step);
          }
          return out;
        };
        for (const code of all(obj, 'TextCode')) {
          if (code.hasAttribute('X')) x = Number(code.getAttribute('X'));
          if (code.hasAttribute('Y')) y = Number(code.getAttribute('Y'));
          const dx = delta(code.getAttribute('DeltaX')), dy = delta(code.getAttribute('DeltaY'));
          const text = code.textContent || '';
          (dx.length || dy.length ? Array.from(text) : [text]).forEach((text, i) => {
            if (i) { x += dx[i - 1] ?? dx[dx.length - 1] ?? 0; y += dy[i - 1] ?? dy[dy.length - 1] ?? 0; }
            const px = b[0] + m[0] * x + m[2] * y + m[4], py = b[1] + m[1] * x + m[3] * y + m[5];
            if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('OFD 坐标无效');
            fragments.push({ x: px, y: py, text, vertical: dy.some((n) => n !== 0) && !dx.some((n) => n !== 0) });
          });
        }
      }
      const singles = fragments.filter((f) => Array.from(f.text).length === 1);
      const vertical = fragments.some((f) => f.vertical) || singles.length > 20 && new Set(singles.map((f) => Math.round(f.x * 5))).size < new Set(singles.map((f) => Math.round(f.y * 5))).size;
      // Bucket into lines/columns, then sort inside each bucket (stable transitive ordering).
      const groups: { axis: number; items: typeof fragments }[] = [];
      for (const f of fragments.sort((a, b) => vertical ? b.x - a.x : a.y - b.y)) {
        const axis = vertical ? f.x : f.y; let group = groups[groups.length - 1];
        if (!group || Math.abs(group.axis - axis) >= .5) { group = { axis, items: [] }; groups.push(group); } group.items.push(f);
      }
      const text = groups.map((g) => g.items.sort((a, b) => vertical ? a.y - b.y : a.x - b.x).map((f) => f.text).join('')).filter((s) => s.trim());
      let html = text.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
      for (const im of layers.flatMap((l) => all(l, 'ImageObject'))) html += image(files[resources.get(im.getAttribute('ResourceID') || '') || '']);
      result.chapters.push({ title: `第 ${result.chapters.length + 1} 页`, html: html || '<p>此页没有可重排的文字或 PNG/JPEG 图片。</p>', chars: text.join('').length });
    }
  }
  if (!result.chapters.some((c) => c.chars || c.html.includes('<img'))) throw new Error('OFD 没有文字层或支持的图片，请先转 PDF 或进行 OCR');
  return result;
}
