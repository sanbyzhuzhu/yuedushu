import { useEffect, useRef, useState } from 'react';
import { registerBackHandler } from '../platform/backHandler';

export const BOOK_PAGE_SIZE = 60;
let shelfPosition: { key: string; page: number } | undefined;
export function useBookPage<T>(items: T[], resetKey: string, size = BOOK_PAGE_SIZE, remember = false) {
  const [position, setPosition] = useState(remember && shelfPosition ? shelfPosition : { key: resetKey, page: 1 });
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(pages, position.key === resetKey ? position.page : 1);
  return { page, pages, total: items.length, size, items: items.slice((page - 1) * size, page * size),
    go: (n: number) => { const next = { key: resetKey, page: Math.max(1, Math.min(pages, n)) }; if (remember) shelfPosition = next; setPosition(next); } };
}

export function BookPages({ page, pages, total, size, go, disabled = false, compact = false }: { page: number; pages: number; total: number; size: number; go: (n: number) => void; disabled?: boolean; compact?: boolean }) {
  const [target, setTarget] = useState('');
  const details = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  const close = () => { if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } };
  useEffect(() => {
    if (!compact || pages <= 1) { setExpanded(false); return; }
    if (!expanded) return;
    const unregister = registerBackHandler(() => { close(); return true; });
    const outside = (event: PointerEvent) => { if (details.current && !details.current.contains(event.target as Node)) details.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => { unregister(); document.removeEventListener('pointerdown', outside); };
  }, [expanded, compact, pages]);
  const jump = <form onSubmit={(e) => { e.preventDefault(); const n = Number(target); if (Number.isInteger(n) && n >= 1 && n <= pages) { go(n); setTarget(''); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } } }}><input aria-label="跳到书架页码" type="number" min={1} max={pages} value={target} disabled={disabled} onChange={(e) => setTarget(e.target.value)} placeholder="页码" /><button disabled={disabled || !target}>跳转</button></form>;
  if (pages <= 1) return null;
  if (compact) return <details ref={details} className="book-page-compact" onToggle={(e) => setExpanded(e.currentTarget.open)} onKeyDown={(e) => { if (e.key === 'Escape' && expanded) { e.preventDefault(); e.stopPropagation(); close(); } }}><summary aria-label={'选择书架页码，当前第 ' + page + ' 页，共 ' + pages + ' 页'}>{page} / {pages} 页 <span aria-hidden="true">⌄</span></summary><div><p>共 {pages} 页</p>{jump}</div></details>;
  return <nav className="book-pages" aria-label="书籍分页">
    <span>第 {(page - 1) * size + 1}–{Math.min(page * size, total)} 本 · 共 {total} 本</span>
    <div><button disabled={disabled || page <= 1} onClick={() => go(page - 1)}>上一页</button><span>{page} / {pages}</span><button disabled={disabled || page >= pages} onClick={() => go(page + 1)}>下一页</button>
      {jump}
    </div>
  </nav>;
}
