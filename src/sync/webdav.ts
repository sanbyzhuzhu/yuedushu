/** 极简 WebDAV 客户端（V0.1.0）
 *  - 串行请求队列 + 最小间隔（尊重坚果云 1200 次/30 分钟限频）
 *  - 传输层可插拔：浏览器 fetch / 未来 Tauri 壳替换为 Rust HTTP（绕过 CORS） */
export interface HttpTransport {
  request(url: string, init: RequestInit): Promise<Response>;
}

export const fetchTransport: HttpTransport = {
  request: (url, init) => fetch(url, init),
};

/** Tauri 壳内使用 plugin-http（Rust 侧 HTTP，绕过 CORS，坚果云直连可用） */
async function getDefaultTransport(): Promise<HttpTransport> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const mod = await import('@tauri-apps/plugin-http');
      return { request: (url, init) => mod.fetch(url, init) as unknown as Promise<Response> };
    } catch {
      /* 插件不可用则回退标准 fetch */
    }
  }
  return fetchTransport;
}

export interface WebDAVOptions {
  url: string; // https://dav.jianguoyun.com/dav/
  username: string;
  password: string;
  basePath: string; // 阅读树
  transport?: HttpTransport;
  minGapMs?: number;
}

function base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function uploadError(path: string, res: Response): Promise<Error> {
  // Only classify known upstream failures; never surface arbitrary server HTML
  // that might contain credentials, cookies or signed storage URLs.
  let detail = '';
  if (res.status >= 500) {
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let text = '';
      try {
        while (text.length < 8192) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += decoder.decode(chunk.value.subarray(0, 8192 - text.length));
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (/AccessDenied|Access denied by bucket policy/i.test(text)) {
        detail = '；网盘代理的上游存储拒绝上传（AccessDenied / bucket policy），请检查 WebDAV 服务端的网盘登录状态与上传配置';
      }
    }
  }
  return new Error(`上传失败（${path}）：HTTP ${res.status}${detail}`);
}

export function joinUrl(...parts: string[]): string {
  const [base, ...rest] = parts;
  const baseClean = base.replace(/\/+$/, '');
  const path = rest
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .map((seg) => seg.split('/').map(encodeURIComponent).join('/'))
    .join('/');
  return path ? `${baseClean}/${path}` : baseClean;
}

export class WebDAVClient {
  private opts: Required<Pick<WebDAVOptions, 'url' | 'username' | 'password' | 'basePath'>> & {
    transport?: HttpTransport;
    minGapMs: number;
  };
  private queue: Promise<unknown> = Promise.resolve();
  private transportP: Promise<HttpTransport> | null = null;
  private lastAt = 0;
  reqCount = 0;

  constructor(o: WebDAVOptions) {
    this.opts = {
      url: o.url,
      username: o.username,
      password: o.password,
      basePath: o.basePath,
      transport: o.transport,
      minGapMs: o.minGapMs ?? 250,
    };
  }

  private async transport(): Promise<HttpTransport> {
    if (this.opts.transport) return this.opts.transport;
    if (!this.transportP) this.transportP = getDefaultTransport();
    this.opts.transport = await this.transportP;
    return this.opts.transport;
  }

  private async raw(method: string, path: string, body?: string | ArrayBuffer): Promise<Response> {
    const url = joinUrl(this.opts.url, this.opts.basePath, path);
    return this.rawAt(method, url, body);
  }

  /** 直接对"相对 WebDAV 根"的绝对路径发起请求（不拼接 basePath）。
   *  建目录必须用这个——否则会被二次拼接成 basePath/basePath（坚果云返回 409） */
  private async rawAbs(method: string, absPath: string, body?: string | ArrayBuffer): Promise<Response> {
    const url = joinUrl(this.opts.url, absPath);
    return this.rawAt(method, url, body);
  }

  private async rawAt(method: string, url: string, body?: string | ArrayBuffer): Promise<Response> {
    const run = async (): Promise<Response> => {
      const wait = Math.max(0, this.opts.minGapMs - (Date.now() - this.lastAt));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = Date.now();
      this.reqCount += 1;
      const transport = await this.transport();
      return transport.request(url, {
        method,
        headers: {
          Authorization: `Basic ${base64(`${this.opts.username}:${this.opts.password}`)}`,
          // 二进制 PUT 也显式带 Content-Type：部分简易 WebDAV 网关对缺失头按 undefined 处理会 500
          ...(body === undefined
            ? {}
            : typeof body === 'string'
              ? { 'Content-Type': 'application/json;charset=utf-8' }
              : { 'Content-Type': 'application/octet-stream' }),
        },
        body,
      });
    };
    const prev = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((r) => (release = r));
    try {
      await prev;
      return await run();
    } finally {
      release();
    }
  }

  /** 逐级建目录（absPath 相对 WebDAV 根，如 "阅读树" / "阅读树/books"）。
   *  逐级创建保证父目录一定先存在；已存在（405/301）视为成功。
   *  注意：旧实现用 raw() 会再拼一次 basePath，变成 basePath/basePath，
   *  父目录不存在 → 服务端 409 → 又被当成"已存在"放过 → 目录从未建成，
   *  后续 GET/PUT manifest.json 全部 409（坚果云同步失败的真正原因）。 */
  async ensureDir(absPath: string): Promise<void> {
    const parts = absPath.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      const res = await this.rawAbs('MKCOL', cur);
      if (!res.ok && res.status !== 405 && res.status !== 301) {
        throw new Error(`建目录失败（${cur}）：HTTP ${res.status}`);
      }
    }
  }

  /** 409（父目录缺失）自愈：建好父目录后重试一次 */
  private async withDirRetry<T>(path: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!msg.includes('HTTP 409')) throw e;
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      await this.ensureDir(dir ? `${this.opts.basePath}/${dir}` : this.opts.basePath);
      return await fn();
    }
  }

  async getJSON<T>(path: string): Promise<T | null> {
    return this.withDirRetry(path, async () => {
      const res = await this.raw('GET', path);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`读取失败（${path}）：HTTP ${res.status}`);
      return (await res.json()) as T;
    });
  }

  async putJSON(path: string, data: unknown): Promise<void> {
    return this.withDirRetry(path, async () => {
      const res = await this.raw('PUT', path, JSON.stringify(data));
      if (!res.ok && res.status !== 201 && res.status !== 204) {
        throw await uploadError(path, res);
      }
    });
  }

  async getRaw(path: string): Promise<ArrayBuffer | null> {
    return this.withDirRetry(path, async () => {
      const res = await this.raw('GET', path);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`读取失败（${path}）：HTTP ${res.status}`);
      return await res.arrayBuffer();
    });
  }

  async putRaw(path: string, data: ArrayBuffer): Promise<void> {
    return this.withDirRetry(path, async () => {
      const res = await this.raw('PUT', path, data);
      if (!res.ok && res.status !== 201 && res.status !== 204) {
        throw await uploadError(path, res);
      }
    });
  }

  /** 独立测试读写权限，不触碰 manifest 或任何书籍。 */
  async testConnection(): Promise<void> {
    await this.ensureDir(this.opts.basePath);
    const token = crypto.randomUUID();
    const path = `.readingtree-test-${token}.json`;
    let written = false;
    try {
      await this.putJSON(path, { token });
      written = true;
      const result = await this.getJSON<{ token?: string }>(path);
      if (result?.token !== token) throw new Error('读回内容不一致，请检查 WebDAV 代理缓存或下载权限');
    } finally {
      if (written) await this.del(path);
    }
  }

  /** 删除远端资源（云端文件改用书名命名后的旧文件清理）；404 视为已删除 */
  async del(path: string): Promise<void> {
    const res = await this.raw('DELETE', path);
    if (!res.ok && res.status !== 404 && res.status !== 200 && res.status !== 204) {
      throw new Error(`删除失败（${path}）：HTTP ${res.status}`);
    }
  }
}
