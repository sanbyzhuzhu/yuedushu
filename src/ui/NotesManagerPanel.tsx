import { useEffect, useMemo, useState } from 'react';
import type { Annotation } from '../engine/types';
import { useLibrary } from '../store/library';
import { allBookAnnotations, changeAnnotation } from '../store/annotations';
import { downloadNotes } from '../engine/notesExport';
import { Panel } from './Panel';
import { NoteCard } from './NoteCard';
import './notesManager.css';

export function NotesManagerPanel({ onClose }: { onClose: () => void }) {
  const books = useLibrary((s) => s.books);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [bookId, setBookId] = useState('');
  const [notesOnly, setNotesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [exporting, setExporting] = useState(false);
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  useEffect(() => {
    let alive = true;
    allBookAnnotations().then((rows) => {
      if (alive) setAnnotations(rows.flatMap(({ k, v }) => v.list.filter((a) => a.kind === 'highlight' && a.bookId === k.slice(12))));
    }).catch(() => { if (alive) setError('笔记读取失败，请关闭后重试'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const available = useMemo(() => annotations.filter((a) => byId.has(a.bookId)), [annotations, byId]);
  const annotatedBooks = useMemo(() => {
    const ids = new Set(available.map((a) => a.bookId));
    return books.filter((b) => ids.has(b.id));
  }, [books, available]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return available.filter((a) => (!bookId || a.bookId === bookId) && (!notesOnly || a.note.trim())
      && (!q || `${byId.get(a.bookId)?.title} ${a.exact} ${a.note}`.toLocaleLowerCase().includes(q)))
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  }, [available, bookId, notesOnly, query, byId]);
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const current = Math.min(page, pages - 1);
  const exportSelection = async () => {
    setExporting(true); setError(''); setMessage('');
    try {
      const lines = ['# 阅读树 · 划线与批注', '', `共 ${filtered.length} 条`, ''];
      for (const a of filtered) {
        lines.push(`## ${byId.get(a.bookId)?.title ?? '书籍'} · 第 ${a.chapter + 1} 节`, '',
          ...a.exact.split('\n').map((line) => `> ${line}`), '');
        if (a.note) lines.push(a.note, '');
      }
      setMessage(await downloadNotes(`阅读树_笔记_${new Date().toISOString().slice(0, 10)}.md`, lines.join('\n')));
    } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setExporting(false); }
  };
  return <Panel label="笔记管理" onClose={() => editing ? setEditing(null) : onClose()}>
    <div className="drawer-head"><h3>笔记管理</h3><button onClick={onClose}>关闭</button></div>
    <p className="panel-intro">重读划线，回看所思。这里只收录划线与批注。</p>
    <div className="notes-manager-tools">
      <input aria-label="搜索笔记" placeholder="搜索书名、划线或批注" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
      <select aria-label="笔记所属书籍" value={bookId} onChange={(e) => { setBookId(e.target.value); setPage(0); }}>
        <option value="">全部书籍</option>{annotatedBooks.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
      </select>
      <label><input type="checkbox" checked={notesOnly} onChange={(e) => { setNotesOnly(e.target.checked); setPage(0); }} />只看有批注的</label>
      <button disabled={!filtered.length || exporting} onClick={() => void exportSelection()}>{exporting ? '正在导出…' : `导出筛选结果（${filtered.length}）`}</button>
    </div>
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    {loading ? <p className="panel-intro">正在整理笔记…</p> : !filtered.length ? <p className="panel-intro">{available.length ? '没有符合条件的笔记。' : '还没有划线与批注，阅读时选中文字即可记录。'}</p> : null}
    <div className="notes-manager-list">{filtered.slice(current * 50, (current + 1) * 50).map((a) => <article key={a.id} className="notes-manager-entry">
      <header><span>《{byId.get(a.bookId)?.title}》 · 第 {a.chapter + 1} 节</span><button onClick={() => setEditing(a)}>编辑</button></header>
      <blockquote className={`note-quote color-${a.color}`}>{a.exact}</blockquote>
      {a.note ? <p className="notes-manager-comment">{a.note}</p> : null}
      <small>{new Date(a.updatedAt ?? a.createdAt).toLocaleDateString('zh-CN')}</small>
    </article>)}</div>
    {pages > 1 ? <div className="notes-manager-pages"><button disabled={!current} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {pages}</span><button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页</button></div> : null}
    {editing ? <NoteCard anno={editing} book={byId.get(editing.bookId)} x={0} y={0}
      onClose={() => setEditing(null)}
      onSave={async (note) => { await changeAnnotation(editing.bookId, editing.id, note); setAnnotations((list) => list.map((a) => a.id === editing.id ? { ...a, note, updatedAt: Date.now() } : a)); setEditing(null); }}
      onDelete={async () => { await changeAnnotation(editing.bookId, editing.id, null); setAnnotations((list) => list.filter((a) => a.id !== editing.id)); setEditing(null); }} /> : null}
  </Panel>;
}
