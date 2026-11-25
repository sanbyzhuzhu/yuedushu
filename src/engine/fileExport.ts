type ExportWindow = Window & {
  ReadingTreeNativeFiles?: { save(id: string, filename: string, mime: string, base64: string): void };
  readingTreeFileResult?: (id: string, path: string, error: string) => void;
};

const pending = new Map<string, { resolve: (path: string) => void; reject: (error: Error) => void }>();

/** Android uses public Downloads; browser downloads keep the browser's chosen location. */
export async function saveExport(blob: Blob, filename: string): Promise<string> {
  const host = window as ExportWindow;
  if (host.ReadingTreeNativeFiles) {
    host.readingTreeFileResult = (id, path, error) => {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(path);
    };
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取导出文件失败'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(blob);
    });
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { host.ReadingTreeNativeFiles!.save(id, filename, blob.type.split(';')[0] || 'application/octet-stream', base64); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return '已交给浏览器下载';
}
