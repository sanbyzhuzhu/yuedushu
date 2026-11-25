import { useState } from 'react';
import { useAnnotations } from '../store/annotations';
import type { Annotation } from '../engine/types';
import { Panel } from './Panel';

export function BookmarkPanel({ onClose, onJump, onAdd }: { onClose: () => void; onJump: (a: Annotation) => void; onAdd: () => Promise<void> }) {
  const { list, update, remove } = useAnnotations();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch { setError('操作未完成，请重试'); }
    finally { setBusy(false); }
  };
  const bookmarks = list.filter((a) => a.kind === 'bookmark' && `${a.note} ${a.exact}`.includes(query.trim())).sort((a, b) => a.chapter - b.chapter || (a.ratio ?? 0) - (b.ratio ?? 0));
  return <Panel label="书签管理" onClose={() => { if (!busy) onClose(); }}>
    <div className="drawer-head"><h3>书签</h3><button disabled={busy} onClick={onClose}>关闭</button></div>
    <button className="primary" disabled={busy} onClick={() => void run(onAdd)}>添加当前位置</button>
    <input className="field bookmark-search" aria-label="查找书签" placeholder="查找书签名称或章节" value={query} onChange={(e) => setQuery(e.target.value)} />
    {error ? <p role="alert">{error}</p> : null}
    {!bookmarks.length ? <p className="panel-empty">{query ? '没有符合条件的书签' : '还没有书签，留下一个位置，下次回来读'}</p> : null}
    {bookmarks.map((a) => <div className="bookmark-entry" key={a.id}>
      <button className="bookmark-jump" disabled={busy} onClick={() => onJump(a)}><strong>{a.note || a.exact || `第 ${a.chapter + 1} 节`}</strong><small>{a.exact}{a.ratio != null ? ` · 位置 ${Math.round(a.ratio * 100)}%` : ''}</small></button>
      <div className="bookmark-actions"><button disabled={busy} onClick={() => { setEditing(a.id); setName(a.note); }}>重命名</button><button disabled={busy} onClick={() => setDeleting(a.id)}>删除书签</button></div>
      {editing === a.id ? <form className="category-create" onSubmit={(e) => { e.preventDefault(); void run(async () => { await update(a.id, { note: name.trim() }); setEditing(null); }); }}><input className="field" aria-label="书签名称" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /><button disabled={busy}>保存名称</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button></form> : null}
      {deleting === a.id ? <div className="category-confirm"><span>删除此书签？正文和笔记不受影响。</span><button disabled={busy} onClick={() => void run(async () => { await remove(a.id); setDeleting(null); })}>确认删除书签</button><button disabled={busy} onClick={() => setDeleting(null)}>取消</button></div> : null}
    </div>)}
  </Panel>;
}
