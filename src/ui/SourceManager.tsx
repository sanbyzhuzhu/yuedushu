import { useEffect, useState } from 'react';
import type { BookSource } from '../engine/networkLibrary';
import { auditSources } from '../engine/sourceAudit';
import type { SourceAuditResult } from '../engine/sourceAudit';
import { platform } from '../platform/web';

export function SourceManager({ sources, busy, run, save, progress }: {
  sources: BookSource[]; busy: boolean;
  run: (action: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  save: (sources: BookSource[]) => Promise<void>;
  progress: (text: string) => void;
}) {
  const [query, setQuery] = useState('西游记');
  const [results, setResults] = useState<SourceAuditResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [clearAll, setClearAll] = useState(false);
  useEffect(() => {
    let active = true;
    setLoaded(false); setResults([]); setSelected(new Set()); setConfirm(false); setClearAll(false); setPage(0);
    void platform.kvGet<{ query: string; entries: { source: string; result: SourceAuditResult }[] }>('networkSourceAudit').then(saved => {
      if (!active) return;
      if (saved) {
        const entries = new Map(saved.entries.map(entry => [entry.source, entry.result]));
        setQuery(saved.query);
        setResults(sources.flatMap((source, index) => {
          const result = entries.get(JSON.stringify(source));
          return result ? [{ ...result, index }] : [];
        }));
      }
      setLoaded(true);
    }).catch(() => { if (active) progress('无法读取已保存的检测结果，请重新打开重试'); });
    return () => { active = false; };
  }, [sources]);
  async function check(signal: AbortSignal, resume: boolean) {
    const previous = resume ? results : [];
    const done = new Set(previous.map(result => result.index));
    const indices = sources.map((_, index) => index).filter(index => !done.has(index));
    const collected = [...previous];
    let writes = Promise.resolve();
    let writeError: unknown;
    setResults(previous); setSelected(new Set()); setConfirm(false); setPage(0);
    await platform.kvSet('networkSourceAudit', { query, entries: previous.map(result => ({ source: JSON.stringify(sources[result.index]), result })) });
    try {
      await auditSources(indices.map(index => sources[index]), query, signal, result => {
        collected.push({ ...result, index: indices[result.index] });
        setResults([...collected]);
        const snapshot = { query, entries: collected.map(result => ({ source: JSON.stringify(sources[result.index]), result })) };
        writes = writes.then(() => platform.kvSet('networkSourceAudit', snapshot)).catch(error => { writeError = error; });
        progress(`正在检测书源 ${collected.length} / ${sources.length}`);
      });
    } finally {
      await writes;
      if (writeError) throw new Error('检测结果保存失败，请勿退出并稍后重试');
    }
  }
  const failed = results.filter(r => r.status === 'failed');
  const empty = results.filter(r => r.status === 'empty');
  const pages = Math.max(1, Math.ceil(results.length / 50));
  return <details className="network-note" open>
    <summary>批量检测与清理书源</summary>
    <p className="network-hint">检测搜索、目录和首章，结果自动保存，退出后可继续。</p>
    <label className="network-label">检测书名<input className="field" value={query} disabled={busy || !loaded} onChange={e => { setQuery(e.target.value); setResults([]); }} /></label>
    <div className="network-actions">
      <button disabled={busy || !loaded || !sources.length || !query.trim()} onClick={() => void run(signal => check(signal, false))}>检测全部书源（{sources.length}）</button>
      {results.length > 0 && results.length < sources.length ? <button disabled={busy || !loaded} onClick={() => void run(signal => check(signal, true))}>继续检测剩余（{sources.length - results.length}）</button> : null}
      <button disabled={busy || !failed.length} onClick={() => { setSelected(new Set(failed.map(r => r.index))); setConfirm(false); }}>选择检测失败（{failed.length}）</button>
      <button disabled={busy || !empty.length} onClick={() => { setSelected(new Set(empty.map(r => r.index))); setConfirm(false); }}>选择无结果（{empty.length}）</button>
      <button disabled={busy || !selected.size} onClick={() => { setSelected(new Set()); setConfirm(false); }}>取消选择</button>
    </div>
    {results.length ? <p role="status">已检测 {results.length} / {sources.length}：可读 {results.filter(r => r.status === 'readable').length}，无结果 {empty.length}，失败 {failed.length}</p> : null}
    {results.slice(page * 50, (page + 1) * 50).map(result => <label className="network-label" key={result.index}>
      <span><input type="checkbox" disabled={busy} checked={selected.has(result.index)} onChange={e => {
        const checked = e.target.checked;
        setSelected(prev => { const next = new Set(prev); checked ? next.add(result.index) : next.delete(result.index); return next; }); setConfirm(false);
      }} /> {sources[result.index]?.bookSourceName} · {result.status === 'readable' ? '可读' : result.status === 'empty' ? '无结果' : '检测失败'}</span>
      <small>{result.detail}</small>
    </label>)}
    {pages > 1 ? <div className="network-actions"><button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>上一页检测</button><span>{page + 1} / {pages}</span><button disabled={busy || page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页检测</button></div> : null}
    <div className="network-actions"><button disabled={busy || !selected.size} onClick={() => { setConfirm(true); setClearAll(false); }}>批量移除所选（{selected.size}）</button><button disabled={busy || !sources.length} onClick={() => { setClearAll(true); setConfirm(false); }}>一键清空所有书源</button></div>
    {clearAll ? <div role="alert"><p>确定清空全部 {sources.length} 个书源？已入架书籍保留。</p><button disabled={busy} onClick={() => void run(async () => { await save([]); await platform.kvSet('networkSourceAudit', { query, entries: [] }); })}>确认清空所有书源</button><button disabled={busy} onClick={() => setClearAll(false)}>保留书源</button></div> : null}
    {confirm ? <div role="alert"><p>确定移除所选 {selected.size} 个书源？只移除书源配置，已入架书籍保留；恢复需重新导入。</p><button disabled={busy} onClick={() => void run(async () => { await save(sources.filter((_, index) => !selected.has(index))); })}>确认移除</button><button disabled={busy} onClick={() => setConfirm(false)}>保留书源</button></div> : null}
  </details>;
}
