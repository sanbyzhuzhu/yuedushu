import { useEffect, useState } from 'react';
import { Panel } from './Panel';
import { listDeletedBooks, restoreDeletedBook, purgeDeletedBook, type DeletedBookSummary } from '../engine/recycleBin';
import { useLibrary } from '../store/library';

export function RecycleBinPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Array<{ k: string; v: DeletedBookSummary }>>([]);
  const [status, setStatus] = useState('正在读取…');
  const [busy, setBusy] = useState(false);
  async function refresh() { setItems(await listDeletedBooks()); setStatus('已删除的书保留 30 天，包含正文、笔记和阅读进度；回收站仅保存在本机。'); }
  useEffect(() => { void refresh().catch(e => setStatus(String(e))); }, []);
  async function act(key: string, restore: boolean) {
    if (!restore && !window.confirm('彻底删除后无法恢复，确定吗？')) return;
    setBusy(true);
    try {
      if (restore) { await restoreDeletedBook(key); await useLibrary.getState().init(); }
      else await purgeDeletedBook(key);
      await refresh();
    } catch (e) { setStatus(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  }
  return <Panel label="回收站" onClose={onClose}>
    <div className="drawer-head"><h3>回收站</h3><button onClick={onClose}>关闭</button></div>
    <p className="set-hint" role="status">{status}</p>
    {!items.length ? <p className="panel-empty">回收站为空</p> : items.map(({ k, v }) => <div className="set-group" key={k}><strong>{v.meta.title}</strong><p className="set-hint">{new Date(v.deletedAt).toLocaleDateString('zh-CN')} 删除</p><button disabled={busy} onClick={() => void act(k, true)}>恢复到书架</button><button disabled={busy} onClick={() => void act(k, false)}>彻底删除</button></div>)}
  </Panel>;
}
