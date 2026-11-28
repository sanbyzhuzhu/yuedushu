import { decodeText } from './txt';

export function decodeSourceResponse(data: Uint8Array, contentType: string): string {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf || data[0] === 0xff && data[1] === 0xfe || data[0] === 0xfe && data[1] === 0xff) return decodeText(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  const prefix = new TextDecoder('ascii').decode(data.subarray(0, 2048));
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] || /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(prefix)?.[1];
  if (charset) { try { return new TextDecoder(charset).decode(data); } catch { /* Fall back to the established UTF/GB detection. */ } }
  return decodeText(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}
