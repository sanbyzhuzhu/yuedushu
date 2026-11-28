import { useMemo, useState } from 'react';
import { MAX_POETRY_MERGE } from '../engine/poetryCollection';
import type { PoetryCollection, Poem } from '../engine/poetryCollection';
import './poetryPicker.css';

export function PoetryPicker({ collection, title, disabled, onImport, onSaveRaw, onClose }: { collection: PoetryCollection; title: string; disabled: boolean; onImport: (title: string, poems: Poem[]) => void; onSaveRaw: () => void; onClose: () => void }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0), [name, setName] = useState(title);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const matches = useMemo(() => { const term = query.trim().toLowerCase(); return collection.poems.filter(p => !term || `${p.title} ${p.author} ${p.lines.join(' ')}`.toLowerCase().includes(term)); }, [query, collection]);
  const last = Math.max(0, Math.ceil(matches.length / 50) - 1), current = Math.min(last, page);
  const visible = matches.slice(current * 50, (current + 1) * 50);
  const chosen = useMemo(() => collection.poems.filter(p => selected.has(p.id)), [collection, selected]);
  return <section className="network-note" aria-label="诗词 JSON 预览">
    <div className="network-result-head"><h4>{title}</h4><button disabled={disabled} onClick={onClose}>关闭预览</button></div>
    <p className="network-hint">可读 {collection.poems.length} 篇{collection.skipped ? `，另有 ${collection.skipped} 条非诗词数据` : ''}。已选 {selected.size} 篇，每本最多合并 10000 篇。</p>
    <label className="network-label">选集名称<input className="field" value={name} disabled={disabled} onChange={e => setName(e.target.value)} /></label>
    <label className="network-label">筛选诗词<input className="field" type="search" placeholder="题目 / 作者 / 正文" value={query} disabled={disabled} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
    <div className="network-actions"><button disabled={disabled || !matches.length || matches.length > MAX_POETRY_MERGE} onClick={() => setSelected(new Set(matches.map(p => p.id)))}>选中筛选结果</button><button disabled={disabled || !selected.size} onClick={() => setSelected(new Set())}>清空诗词选择</button></div>
    {visible.map(poem => <label key={poem.id} className="network-poem"><input type="checkbox" aria-label={`选择诗词 ${poem.title}（${poem.id + 1}）`} disabled={disabled || !selected.has(poem.id) && selected.size >= MAX_POETRY_MERGE} checked={selected.has(poem.id)} onChange={e => setSelected(prev => { const next = new Set(prev); e.target.checked ? next.add(poem.id) : next.delete(poem.id); return next; })} /><span><strong>{poem.title}</strong>{poem.author ? <small>{poem.author}</small> : null}<small>{poem.lines[0]}</small></span></label>)}
    {!matches.length ? <p className="network-hint">没有匹配的诗词。原始 JSON 仍可下载保存。</p> : null}
    {last > 0 ? <div className="network-actions"><button disabled={disabled || current === 0} onClick={() => setPage(current - 1)}>上一页诗词</button><span>{current + 1} / {last + 1}</span><button disabled={disabled || current === last} onClick={() => setPage(current + 1)}>下一页诗词</button></div> : null}
    <div className="network-actions"><button className="primary" disabled={disabled || !chosen.length} onClick={() => onImport(name, chosen)}>所选诗词合并入架</button><button disabled={disabled || !collection.poems.length || collection.poems.length > MAX_POETRY_MERGE} onClick={() => onImport(name, collection.poems)}>整份 JSON 合并入架</button><button disabled={disabled} onClick={onSaveRaw}>下载原始 JSON</button></div>
  </section>;
}
