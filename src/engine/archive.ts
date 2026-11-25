import { unzipSync } from 'fflate';
export class ArchiveLimitError extends Error {}
/** Check central-directory sizes before allocating decompressed book assets. */
export function unzipBook(bytes: Uint8Array, limits = { total: 512 * 1024 * 1024, entry: 128 * 1024 * 1024, count: 30000 }) {
  let total = 0, count = 0;
  return unzipSync(bytes, { filter: entry => {
    total += entry.originalSize; count++;
    if (total > limits.total || entry.originalSize > limits.entry || count > limits.count) throw new ArchiveLimitError('压缩书籍展开后过大或文件过多，请拆分后导入（总量最多 512 MiB，单项最多 128 MiB）');
    return true;
  } });
}
