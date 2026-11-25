/** 批注编辑卡（Reader 与 PdfReader 共用）；V0.3.1 增加分享图生成 */
import { useState } from 'react';
import { renderShareCard, downloadBlob } from '../engine/shareCard';
import type { Annotation } from '../engine/types';

function readDraft(anno: Annotation): string {
  try {
    const saved = JSON.parse(localStorage.getItem(`note-draft:${anno.bookId}:${anno.id}`) || 'null');
    // 已从其他位置更新过的笔记，不被旧草稿覆盖。
    return saved?.base === anno.note && typeof saved.text === 'string' ? saved.text : anno.note;
  } catch { return anno.note; }
}

export function NoteCard({
  anno,
  book,
  canDelete = true,
  onSave,
  onDelete,
  onClose,
}: {
  anno: Annotation;
  x: number;
  y: number;
  book?: { title: string; author?: string };
  canDelete?: boolean;
  onSave: (note: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => readDraft(anno));
  const [busy, setBusy] = useState<'share' | 'save' | 'delete' | null>(null);
  const [draftFailed, setDraftFailed] = useState(false);
  const [err, setErr] = useState('');
  const draftKey = `note-draft:${anno.bookId}:${anno.id}`;
  const updateDraft = (text: string) => {
    setDraft(text);
    try {
      if (text === anno.note) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify({ base: anno.note, text }));
      setDraftFailed(false);
    } catch { setDraftFailed(true); }
  };

  const share = async () => {
    if (!book) return;
    setBusy('share');
    setErr('');
    try {
      const blob = await renderShareCard(book.title, book.author ?? '', { ...anno, note: draft });
      setErr(await downloadBlob(blob, `阅读树_分享图_${new Date().toISOString().slice(0, 10)}.png`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(null);
    }
  };

  const commit = async (kind: 'save' | 'delete', action: () => void | Promise<void>) => {
    setBusy(kind);
    setErr('');
    try {
      await action();
      try { localStorage.removeItem(draftKey); } catch { /* 已完成正式保存。 */ }
    }
    catch { setErr(`${kind === 'delete' ? '删除' : '保存'}失败，请重试。你的笔记仍保留在这里。`); }
    finally { setBusy(null); }
  };

  return (
    <div className="note-mask" onClick={(e) => e.stopPropagation()}>
    <div
      className="note-card"
      role="dialog" aria-modal="true" aria-label="编辑读书笔记"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Tab') {
          const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)'));
          const first = controls[0], last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !busy && !e.nativeEvent.isComposing) {
          e.preventDefault(); void commit('save', () => onSave(draft));
        }
      }}
    >
      <div className="note-heading"><strong>读书笔记</strong><span>让阅读留下回响</span></div>
      <p className="note-quote">
        {anno.exact}
      </p>
      <textarea aria-label="笔记内容" value={draft} disabled={!!busy} onChange={(e) => updateDraft(e.target.value)} placeholder="此刻的想法，值得记下来…" rows={5} autoFocus />
      <div className="note-meta"><span role="status">{draftFailed ? '草稿暂存失败，请保存笔记后再关闭' : draft !== anno.note ? '草稿已留在本机 · 下次打开继续写' : 'Ctrl / ⌘ + Enter 保存'}</span><span>{draft.length} 字</span></div>
      {err ? <p className="set-hint" style={{ margin: 0 }}>{err}</p> : null}
      <div className="note-actions">
        <button disabled={!!busy} onClick={onClose}>关闭</button>
        {draft !== anno.note ? <button disabled={!!busy} onClick={() => updateDraft(anno.note)}>放弃草稿</button> : null}
        {book ? (
          <button disabled={!!busy} onClick={() => void share()}>
            {busy === 'share' ? '生成中…' : '分享图'}
          </button>
        ) : null}
        {canDelete ? (
          <button disabled={!!busy} className="danger" onClick={() => { if (window.confirm('删除这条划线与批注？')) void commit('delete', onDelete); }}>
            {busy === 'delete' ? '删除中…' : '删除划线'}
          </button>
        ) : null}
        <button disabled={!!busy} className="primary" onClick={() => void commit('save', () => onSave(draft))}>
          {busy === 'save' ? '保存中…' : '保存笔记'}
        </button>
      </div>
    </div>
    </div>
  );
}
