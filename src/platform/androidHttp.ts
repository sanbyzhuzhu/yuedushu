type NativeHttp = { fetch(id: string, url: string, method: string, headers: string, body: string, limit: number): void; fetchWebdav?(id: string, url: string, method: string, headers: string, body: string, limit: number): void; cancel(id: string): void };
type HttpWindow = Window & { ReadingTreeNativeHttp?: NativeHttp; readingTreeHttpEvent?: (id: string, kind: string, payload: string) => void };
type Pending = { status: number; headers: Record<string, string>; chunks: Uint8Array[]; finish: (error?: Error) => void };
const requests = new Map<string, Pending>();

export function hasAndroidHttp(): boolean { return !!(window as HttpWindow).ReadingTreeNativeHttp; }

export function androidFetch(url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal; body?: string }, limit: number, webdav = false): Promise<Response> {
  const host = window as HttpWindow;
  const native = host.ReadingTreeNativeHttp!;
  host.readingTreeHttpEvent = (id, kind, payload) => {
    const request = requests.get(id);
    if (!request) return;
    try {
      if (kind === 'headers') Object.assign(request, JSON.parse(payload));
      else if (kind === 'chunk') {
        const text = atob(payload);
        request.chunks.push(Uint8Array.from(text, (c) => c.charCodeAt(0)));
      } else if (kind === 'done') request.finish();
      else if (kind === 'error') request.finish(new Error(payload));
    } catch (e) { native.cancel(id); request.finish(e instanceof Error ? e : new Error('响应读取失败')); }
  };
  const id = `http-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const abort = () => { native.cancel(id); request.finish(new Error('已取消')); };
    const request: Pending = { status: 0, headers: {}, chunks: [], finish: (error) => {
      requests.delete(id); init.signal.removeEventListener('abort', abort);
      if (error) { reject(error); return; }
      try {
        const body = [204, 205, 304].includes(request.status) ? null : new Blob(request.chunks as BlobPart[]);
        resolve(new Response(body, { status: request.status, headers: request.headers }));
      } catch (e) { reject(e); }
    } };
    requests.set(id, request);
    if (init.signal.aborted) { request.finish(new Error('已取消')); return; }
    init.signal.addEventListener('abort', abort, { once: true });
    try {
      if (new URL(url).protocol === 'http:') {
        if (!native.fetchWebdav) throw new Error('此安装版本不支持 HTTP 书库，请升级应用。');
        native.fetchWebdav(id, url, init.method, JSON.stringify(init.headers), init.body || '', limit);
      } else native.fetch(id, url, init.method, JSON.stringify(init.headers), init.body || '', limit);
    }
    catch (e) { request.finish(e instanceof Error ? e : new Error('无法启动安卓网络请求')); }
  });
}
