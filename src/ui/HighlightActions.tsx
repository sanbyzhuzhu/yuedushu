import { useEffect, useRef, useState } from 'react';
import type { Annotation } from '../engine/types';
import { copyText } from '../engine/clipboard';

/** Existing highlights act on the saved quote, without creating a new selection. */
export function HighlightActions({ anno, onEdit, onRemove, onClose }: {
  anno: Annotation;
  onEdit: () => void;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  useEffect(() => { panel.current?.querySelector('button')?.focus(); }, []);
  const run = async (action: () => Promise<void>, success?: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try { await action(); if (success) setMessage(success); }
    catch (e) { setMessage(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="note-mask" onClick={e => { e.stopPropagation(); if (!busy) onClose(); }} onContextMenu={e => e.preventDefault()}>
    <div ref={panel} className="note-card highlight-actions" role="dialog" aria-modal="true" aria-label="划线操作"
      onClick={e => e.stopPropagation()} onKeyDown={e => {
        if (e.key !== 'Tab') return;
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }}>
      <div className="note-heading"><strong>划线操作</strong><span>{anno.exact.length} 字</span></div>
      <p className="note-quote">{anno.exact}</p>
      {anno.note ? <p className="highlight-note">{anno.note}</p> : null}
      <div className="note-actions">
        <button disabled={busy} onClick={() => void run(() => copyText(anno.exact), '已复制原文')}>复制原文</button>
        {anno.note ? <button disabled={busy} onClick={() => void run(() => copyText(anno.note), '已复制笔记')}>复制笔记</button> : null}
        <button disabled={busy} onClick={onEdit}>{anno.note ? '编辑笔记' : '写笔记'}</button>
        <button disabled={busy} className="danger" onClick={() => {
          if (anno.note && !window.confirm('这条划线有笔记，撤销将同时删除笔记，是否继续？')) return;
          void run(onRemove);
        }}>撤销划线</button>
        <button disabled={busy} onClick={onClose}>关闭</button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </div>
  </div>;
}
