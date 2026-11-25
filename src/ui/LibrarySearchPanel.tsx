import { useEffect, useRef, useState } from 'react';
import { Panel } from './Panel';
import { useLibrary } from '../store/library';
import { searchLibrary, type LibrarySearchHit } from '../engine/librarySearch';
import { platform } from '../platform/web';

export function LibrarySearchPanel({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<LibrarySearchHit[]>([]);
  const [status, setStatus] = useState('输入记得的字句，查找本地藏书');
  const work = useRef<AbortController | null>(null);
  useEffect(() => () => work.current?.abort(), []);
  async function search() {
    work.current?.abort(); const controller = new AbortController(); work.current = controller;
    setHits([]); setStatus('正在查找…');
    try {
      await searchLibrary(useLibrary.getState().books, query, controller.signal, (next, done) => {
        setHits(next); setStatus(`已查 ${done} 本 · 找到 ${next.length} 处（最多 200 处）`);
      });
      if (!controller.signal.aborted) setStatus(s => `查找完成 · ${s}`);
    } catch (e) { if (!controller.signal.aborted) setStatus(e instanceof Error ? e.message : '查找失败'); }
  }
  async function open(hit: LibrarySearchHit) {
    work.current?.abort();
    try {
      await platform.kvSet('pending-search', { bookId: hit.bookId, chapter: hit.chapter, quote: hit.quote });
      onClose(); onOpen(hit.bookId);
    } catch (e) { setStatus(e instanceof Error ? e.message : '无法打开，请重试'); }
  }
  return <Panel label="跨书全文检索" onClose={onClose}>
    <div className="drawer-head"><h3>跨书全文检索</h3><button onClick={onClose}>关闭</button></div>
    <form onSubmit={e => { e.preventDefault(); void search(); }}><input className="field" aria-label="查找藏书正文" value={query} onChange={e => setQuery(e.target.value)} /><button disabled={!query.trim()}>查找</button><button type="button" onClick={() => { work.current?.abort(); setStatus('已停止'); }}>停止</button></form>
    <p className="set-hint" role="status">{status} · 扫描版 PDF 不参与</p>
    <div className="ann-list">{hits.map((hit, i) => <button className="ann-item" key={`${hit.bookId}-${i}`} onClick={() => void open(hit)}><strong>{hit.bookTitle}</strong><span>{hit.title}</span><span>{hit.snippet}</span></button>)}</div>
  </Panel>;
}
