import { useDeferredValue, useMemo, useState } from 'react';
import { useLibrary } from '../store/library';
import { BookPages, useBookPage } from './BookPages';
import { Panel } from './Panel';

/** 分类管理和选书归类共用一个适配窄屏的面板。 */
export function CategoryPanel({ initialIds, onClose }: { initialIds?: string[]; onClose: () => void }) {
  const { books, nodes, addNode, renameNode, removeNode, moveBooks } = useLibrary();
  const [tab, setTab] = useState(initialIds ? 'books' : 'categories');
  const [selected, setSelected] = useState<string[]>(initialIds ?? []);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const counts = useMemo(() => { const m = new Map<string | null, number>(); for (const b of books) m.set(b.nodeId, (m.get(b.nodeId) ?? 0) + 1); return m; }, [books]);
  const [category, setCategory] = useState('all');
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const visible = useMemo(() => books.filter((b) => (category === 'all' || (b.nodeId ?? '') === category)
    && `${b.title} ${b.author}`.toLocaleLowerCase().includes(deferredQuery.trim().toLocaleLowerCase())), [books, category, deferredQuery]);
  const bookPage = useBookPage(visible, JSON.stringify([category, deferredQuery]));
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await action(); } catch (e) { setMessage(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  };
  const saveName = () => run(async () => {
    if (editing) await renameNode(editing, name);
    else { const id = await addNode(name); if (tab === 'books') setTarget(id); }
    setName(''); setEditing(null); setMessage('分类已保存');
  });
  const move = () => run(async () => {
    await moveBooks(selected, target || null);
    setSelected([]);
    setMessage(`已整理 ${selected.length} 本书`);
  });
  return <Panel label="分类管理" onClose={() => { if (!busy) onClose(); }}>
    <div className="drawer-head"><h3>整理书架</h3><button disabled={busy} onClick={onClose}>完成</button></div>
    <div className="panel-tabs">
      <button disabled={busy} aria-pressed={tab === 'categories'} onClick={() => setTab('categories')}>分类管理</button>
      <button disabled={busy} aria-pressed={tab === 'books'} onClick={() => setTab('books')}>批量归类</button>
    </div>
    <form className="category-create" onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
      <input className="field" aria-label="分类名称" placeholder={editing ? '修改分类名称' : '新建分类名称'} value={name} maxLength={60} disabled={busy} onChange={(e) => setName(e.target.value)} />
      <button className="primary" disabled={busy || !name.trim()}>{editing ? '保存名称' : '新建'}</button>
      {editing ? <button type="button" disabled={busy} onClick={() => { setEditing(null); setName(''); }}>取消</button> : null}
    </form>
    {message ? <p role="status" className="set-hint">{message}</p> : null}
    {tab === 'categories' ? <div className="category-list">
      <p className="set-hint">按分类收纳藏书；删除分类会将其中的书移到未分类，子分类保留。</p>
      {nodes.length === 0 ? <p className="panel-empty">还没有分类，在上方新建一个吧</p> : null}
      {nodes.map((n) => <div className="category-entry" key={n.id}>
        <div><strong>{n.name}</strong><small>{n.parentId ? `${nodeMap.get(n.parentId)?.name ?? ''} · ` : ''}{counts.get(n.id) ?? 0} 本</small></div>
        <button disabled={busy} aria-label={`重命名分类 ${n.name}`} onClick={() => { setEditing(n.id); setName(n.name); setDeleting(null); }}>重命名</button>
        <button disabled={busy} aria-label={`删除分类 ${n.name}`} onClick={() => setDeleting(n.id)}>删除</button>
        {deleting === n.id ? <div className="category-confirm"><span>仅移除分类，保留书籍？</span><button disabled={busy} onClick={() => void run(async () => { await removeNode(n.id); setDeleting(null); if (editing === n.id) { setEditing(null); setName(''); } if (target === n.id) setTarget(''); if (category === n.id) setCategory('all'); setMessage('分类已移除，书籍已保留'); })}>确认删除分类</button><button disabled={busy} onClick={() => setDeleting(null)}>取消</button></div> : null}
      </div>)}
    </div> : <div className="category-books">
      <div className="category-move"><label>移入分类<select className="field" aria-label="移入分类" disabled={busy} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">未分类</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label><button className="primary" disabled={busy || !selected.length} onClick={() => void move()}>{busy ? '整理中…' : `移动选中 ${selected.length} 本`}</button></div>
      <input className="field" aria-label="查找待整理书籍" placeholder="搜书名 / 作者" value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy} />
      <select className="field" aria-label="筛选原分类" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}><option value="all">全部分类</option><option value="">未分类</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
      <div className="category-select"><button disabled={busy || !visible.length} onClick={() => setSelected([...new Set([...selected, ...visible.map((b) => b.id)])])}>全选当前结果</button><button disabled={busy || !selected.length} onClick={() => setSelected([])}>取消全选</button></div>
      {!visible.length ? <p className="panel-empty">没有符合条件的书</p> : null}
      <BookPages {...bookPage} disabled={busy} />
      {bookPage.items.map((b) => <label className="category-book" key={b.id}><input type="checkbox" disabled={busy} checked={selectedSet.has(b.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, b.id] : selected.filter((id) => id !== b.id))} /><span>{b.title}<small>{nodeMap.get(b.nodeId ?? '')?.name ?? '未分类'} · {b.author || '佚名'}</small></span></label>)}
    </div>}
  </Panel>;
}
