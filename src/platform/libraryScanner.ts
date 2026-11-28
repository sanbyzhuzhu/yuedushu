type ScanWindow = Window & {
  ReadingTreeNativeScanner?: { scan(id: string): void };
  readingTreeScanResult?: (id: string, text: string, error: string) => void;
};

export function hasLibraryCamera(): boolean { return !!(window as ScanWindow).ReadingTreeNativeScanner; }

export function scanLibraryCamera(signal: AbortSignal): Promise<string> {
  const host = window as ScanWindow;
  const native = host.ReadingTreeNativeScanner;
  if (!native) return Promise.reject(new Error('请使用“识别二维码图片”，或在新版 Android 安装包中扫码'));
  return new Promise((resolve, reject) => {
    const id = `scan-${Date.now()}`;
    const finish = (value: string, error?: string) => {
      signal.removeEventListener('abort', abort);
      host.readingTreeScanResult = undefined;
      if (error) reject(new Error(error)); else resolve(value);
    };
    const abort = () => finish('', '已取消');
    if (signal.aborted) { reject(new Error('已取消')); return; }
    signal.addEventListener('abort', abort, { once: true });
    host.readingTreeScanResult = (resultId, value, error) => { if (resultId === id) finish(value, error); };
    try { native.scan(id); } catch { finish('', '无法打开扫码相机'); }
  });
}

export async function scanLibraryImage(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error('二维码图片超过 20 MB，请裁剪后重试');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法读取二维码图片');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import('jsqr');
    const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (!code?.data) throw new Error('图片中未找到二维码，请使用清晰、完整的二维码图片');
    return code.data;
  } finally { bitmap.close(); }
}
