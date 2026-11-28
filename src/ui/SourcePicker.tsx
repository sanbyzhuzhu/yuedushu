import { useMemo, useState } from 'react';
import type { BookSource } from '../engine/networkLibrary';

const PAGE_SIZE = 100;
export function SourcePicker({ sources, value, disabled, onChange }: { sources: BookSource[]; value: number; disabled: boolean; onChange: (index: number) => void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase(), result: number[] = [];
    for (let i = 0; i < sources.length; i++) if (!term || sources[i].bookSourceName.toLowerCase().includes(term) || sources[i].bookSourceUrl.toLowerCase().includes(term)) result.push(i);
    return result;
  }, [query, sources]);
  const last = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1), current = Math.min(page, last);
  const visible = matches.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const options = visible.includes(value) || !sources[value] ? visible : [value, ...visible];
  return <>
    <label className="network-label">筛选书源<input className="field" type="search" value={query} disabled={disabled} placeholder="书源名称 / 地址" onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
    <p className="network-hint">已保存 {sources.length} 个书源，匹配 {matches.length} 个；每页最多 100 个。搜索图书时仅使用当前选中的书源。</p>
    <label className="network-label">选择书源<select className="field" aria-label="选择书源" disabled={disabled} value={value} onChange={e => onChange(Number(e.target.value))}>{options.map(i => <option key={i} value={i}>{sources[i].bookSourceName}{!visible.includes(i) ? '（当前选择）' : ''}</option>)}</select></label>
    {!matches.length ? <p className="network-hint">没有匹配的书源，请更换筛选词。</p> : null}
    {last > 0 ? <div className="network-actions"><button disabled={disabled || current === 0} onClick={() => setPage(current - 1)}>上一页书源</button><span>{current + 1} / {last + 1}</span><button disabled={disabled || current === last} onClick={() => setPage(current + 1)}>下一页书源</button></div> : null}
  </>;
}
