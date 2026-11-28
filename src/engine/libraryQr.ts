import { secureUrl } from './networkLibrary';

export interface ScannedLibrary { url: string; kind: 'opds' | 'webdav' | 'web'; name: string }

/** QR contents are data only. Never execute a URL scheme or embedded code. */
export function parseLibraryQr(text: string): ScannedLibrary {
  let value = text.trim(), name = '', kind: ScannedLibrary['kind'] = 'opds';
  if (value.length > 16384) throw new Error('二维码内容过长，请扫描书库地址');
  if (value.startsWith('{')) {
    let data: Record<string, unknown>;
    try { data = JSON.parse(value); } catch { throw new Error('二维码中的书库信息无效'); }
    value = String(data.opdsUrl || data.opds || data.url || data.address || '');
    name = typeof data.name === 'string' ? data.name.slice(0, 100) : '';
    if (data.type === 'webdav' || data.kind === 'webdav') kind = 'webdav';
    else if (data.type === 'web' || data.kind === 'web') kind = 'web';
  }
  // OPDS reader sharing conventions. Explicit HTTP remains HTTP.
  value = value.replace(/^opds:\/\/(https?:\/\/)/i, '$1').replace(/^opds:\/\//i, 'http://');
  let url: URL;
  try { url = new URL(secureUrl(value)); } catch { throw new Error('未识别到书库 HTTP/HTTPS 地址，请扫描 Olib 或 OPDS 书库二维码'); }
  // Olib's wireless sharing QR points at its root page; its catalog is /opds.
  if (kind === 'opds' && url.pathname === '/' && !url.search) url.pathname = '/opds';
  return { url: url.href, kind, name: name || url.hostname };
}
