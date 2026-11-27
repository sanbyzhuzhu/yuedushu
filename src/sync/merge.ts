/** 同步合并策略（纯函数，可 Node 测试）
 *  - 进度：时间戳新者胜（含设备名）
 *  - 笔记：按 id 并集 + 删除墓碑并集
 *  - 分类/书架：并集 + 墓碑；同 id 冲突取 updatedAt 新者
 *  - 书 meta：新者胜；cover 按独立修订合并（manifest 只带标记和修订时间） */
import type { Annotation, BookMeta, CatNode } from '../engine/types';
import type { RemoteBook, RemoteManifest, SyncTombstones } from './types';

export function union<T>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])];
}

export function newerMeta(a: BookMeta, b: BookMeta): BookMeta {
  const ta = a.updatedAt ?? a.addedAt ?? 0;
  const tb = b.updatedAt ?? b.addedAt ?? 0;
  const win = tb > ta ? b : a;
  const ca = a.coverUpdatedAt ?? 0, cb = b.coverUpdatedAt ?? 0;
  const owner = cb > ca ? b : a;
  const result = { ...win };
  delete result.cover;
  if (ca || cb) {
    result.coverUpdatedAt = Math.max(ca, cb);
    // A manifest can announce a new cover without carrying its bytes. Never label
    // the previous cover with that new revision or resurrect an explicit removal.
    result.hasCover = owner.hasCover ?? !!owner.cover;
    const bytes = owner.cover ?? (ca === cb ? (a.cover ?? b.cover) : undefined);
    if (result.hasCover && bytes) result.cover = bytes;
  } else {
    const cover = win.cover ?? a.cover ?? b.cover;
    result.hasCover = !!cover || a.hasCover === true || b.hasCover === true;
    if (cover) result.cover = cover;
  }
  return result;
}

export interface ManifestMergeResult {
  nodes: CatNode[];
  metas: Map<string, BookMeta>; // 合并后的本地视角（含 cover 保留）
  deletedBooks: string[];
  deletedNodes: string[];
  changed: boolean; // 本地是否需要应用/写回
}

export function mergeManifest(
  localNodes: CatNode[],
  localBooks: BookMeta[],
  localDeleted: SyncTombstones,
  remote: RemoteManifest | null,
): ManifestMergeResult {
  const deletedBooks = remote ? union(localDeleted.books, remote.deletedBookIds) : localDeleted.books;
  const deletedNodes = remote ? union(localDeleted.nodes, remote.deletedNodeIds) : localDeleted.nodes;

  // 分类：并集，同 id 取新者
  const nodeMap = new Map<string, CatNode>();
  for (const n of localNodes) nodeMap.set(n.id, n);
  if (remote) {
    for (const n of remote.nodes) {
      const cur = nodeMap.get(n.id);
      nodeMap.set(n.id, !cur || (n.updatedAt ?? 0) > (cur.updatedAt ?? 0) ? n : cur);
    }
  }
  const nodes = [...nodeMap.values()].filter((n) => !deletedNodes.includes(n.id));

  // 书 meta：并集，新者胜，cover 保留
  const metas = new Map<string, BookMeta>();
  for (const b of localBooks) metas.set(b.id, b);
  if (remote) {
    for (const rb of remote.books) {
      const { rev: _rev, ...metaMin } = rb;
      const cur = metas.get(rb.id);
      metas.set(rb.id, cur ? newerMeta(cur, metaMin) : metaMin);
    }
  }
  for (const id of deletedBooks) metas.delete(id);

  // 变更检测
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const changed =
    !remote ||
    !same(nodes, localNodes) ||
    !same([...metas.values()], localBooks.filter((b) => !deletedBooks.includes(b.id))) ||
    !same(deletedBooks, localDeleted.books) ||
    !same(deletedNodes, localDeleted.nodes);

  return { nodes, metas, deletedBooks, deletedNodes, changed };
}

export interface MergeBookInput {
  local: RemoteBook | null;
  remote: RemoteBook | null;
  deviceId: string;
}

/** 合并单本书；changed = 本地需要写回 */
export function mergeBook(input: MergeBookInput): { merged: RemoteBook | null; changed: boolean } {
  const { local, remote, deviceId } = input;
  if (!local && !remote) return { merged: null, changed: false };
  if (!remote) return { merged: local, changed: false };
  if (!local) return { merged: remote, changed: true };

  const meta = newerMeta(local.meta, remote.meta);
  const progress =
    (local.progress?.updatedAt ?? 0) >= (remote.progress?.updatedAt ?? 0)
      ? local.progress
      : remote.progress;

  // 笔记：并集 - 墓碑并集
  const deletedAnnotationIds = union(local.deletedAnnotationIds, remote.deletedAnnotationIds);
  const annMap = new Map<string, Annotation>();
  for (const a of [...local.annotations, ...remote.annotations]) {
    const previous = annMap.get(a.id);
    if (!previous || (a.updatedAt ?? a.createdAt) > (previous.updatedAt ?? previous.createdAt)) annMap.set(a.id, a);
  }
  for (const id of deletedAnnotationIds) annMap.delete(id);
  const annotations = [...annMap.values()].sort((a, b) => a.createdAt - b.createdAt);

  const updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  const merged: RemoteBook = {
    bookId: local.bookId || remote.bookId,
    updatedAt,
    device: progress && progress.updatedAt === updatedAt ? (local.progress === progress ? local.device : remote.device) : deviceId,
    meta,
    progress,
    annotations,
    deletedAnnotationIds,
    rev: updatedAt,
    // V0.2.0 资产透传：内容/文件/本书方案不可变或本地权威，本地缺失时从远端恢复
    content: local.content ?? remote.content,
    fileInfo: local.fileInfo ?? remote.fileInfo,
    style: local.style ?? remote.style,
  };
  // changed 只看核心字段（资产透传不触发本地写回）
  const core = (b: RemoteBook) => {
    const { content: _c, fileInfo: _f, style: _s, ...c } = b;
    return c;
  };
  const changed = JSON.stringify(core(merged)) !== JSON.stringify(core(local));
  return { merged, changed };
}
