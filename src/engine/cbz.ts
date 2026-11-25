/** CBZ 漫画包解析（V0.3.2）：zip 内图片按自然序成页，一页一章；
 *  图片以 data URL 内联（划线/灯箱/横竖排全功能可用），封面取首页（浏览器降采样，Node 跳过） */
import { unzipBook } from './archive';
import type { ParsedChapter } from './epub';

export interface ParsedCbz {
  title: string;
  author: string;
  cover?: string;
  chapters: ParsedChapter[];
}

const IMG_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

function mimeOf(path: string): string {
  const e = (path.split('.').pop() ?? '').toLowerCase();
  switch (e) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'avif':
      return 'image/avif';
    default:
      return 'image/jpeg';
  }
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/** 浏览器下把封面降采样到 320px；无 2D 上下文环境（Node/受限 WebView）返回 undefined */
async function coverDataUrl(dataUrl: string): Promise<string | undefined> {
  try {
    const canvas = document.createElement('canvas');
    if (!canvas.getContext('2d')) return undefined;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('图片解码失败'));
      im.src = dataUrl;
    });
    const max = 320;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return undefined;
  }
}

export async function parseCbz(buf: ArrayBuffer, fallbackTitle: string): Promise<ParsedCbz> {
  const files = unzipBook(new Uint8Array(buf));
  const pages = Object.keys(files)
    .filter((k) => IMG_RE.test(k) && !k.includes('__MACOSX'))
    .sort(new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }).compare);

  if (!pages.length) throw new Error('CBZ 中未找到图片（支持 jpg / png / webp / gif 等）');

  const chapters: ParsedChapter[] = pages.map((p, i) => ({
    title: `第 ${i + 1} 页`,
    html: `<img class="comic-page" src="${toDataUrl(files[p], mimeOf(p))}" />`,
    chars: 1,
  }));

  const firstSrc = chapters[0].html.match(/src="([^"]+)"/)?.[1] ?? '';
  const cover = await coverDataUrl(firstSrc);
  return { title: fallbackTitle, author: '', cover, chapters };
}
