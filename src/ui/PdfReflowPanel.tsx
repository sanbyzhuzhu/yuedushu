import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Panel } from './Panel';
import { reflowPdf } from '../engine/pdfReflow';
import { useLibrary } from '../store/library';
import type { BookMeta } from '../engine/types';

export function PdfReflowPanel({ doc, book, onClose, onOpen }: { doc: PDFDocumentProxy; book: BookMeta; onClose: () => void; onOpen: (id: string) => void }) {
  const [from, setFrom] = useState(1), [to, setTo] = useState(Math.min(1000, doc.numPages));
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [result, setResult] = useState<{ id: string; empty: number } | null>(null);
  const work = useRef<AbortController | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; work.current?.abort(); }; }, []);
  const close = () => { if (saving) return; work.current?.abort(); onClose(); };
  async function start() {
    if (work.current) return;
    const controller = new AbortController(); work.current = controller;
    setBusy(true); setError(''); setResult(null);
    try {
      const output = await reflowPdf(doc, book.title, book.author, from, to, controller.signal, (done, total) => setProgress(`正在提取 ${done} / ${total} 页`));
      controller.signal.throwIfAborted(); setSaving(true); setProgress('正在保存重排副本…');
      const created = await useLibrary.getState().importFile(output.file);
      if (alive.current) setResult({ id: created.id, empty: output.emptyPages });
    } catch (e) { if (alive.current) setError(controller.signal.aborted ? '已取消，未创建重排副本' : e instanceof Error ? e.message : String(e)); }
    finally { work.current = null; if (alive.current) { setBusy(false); setSaving(false); } }
  }
  const valid = Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to <= doc.numPages && from <= to && to - from < 1000;
  return <Panel label="PDF 文字重排" onClose={close}>
    <div className="drawer-head"><h3>文字重排</h3><button disabled={saving} onClick={close}>关闭</button></div>
    <p className="panel-intro">将可提取的文字整理成一本新书，字号、横竖排和划线沿用普通阅读器。</p>
    <p className="network-hint">原 PDF、书签和批注保留；重排副本单独记笔记。图片、表格、双栏和脚注不保证还原，扫描页不会自动识字。</p>
    <div className="network-range"><label className="network-label">从第几页<input className="field" type="number" value={from} min={1} max={doc.numPages} disabled={busy} onChange={(e) => setFrom(Number(e.target.value))} /></label><label className="network-label">到第几页<input className="field" type="number" value={to} min={1} max={doc.numPages} disabled={busy} onChange={(e) => setTo(Number(e.target.value))} /></label></div>
    <p className="network-hint">原文件共 {doc.numPages} 页，每次最多重排 1000 页。</p>
    {!result ? <button className="primary" disabled={busy || !valid} onClick={() => void start()}>生成重排副本</button> : <div className="network-note" role="status"><p>重排副本已加入书架。{result.empty ? `${result.empty} 页未提取到文字，可在原 PDF 中查看图片。` : ''}</p><button className="primary" onClick={() => onOpen(result.id)}>阅读重排副本</button></div>}
    {busy ? <div className="network-status" role="status"><span>{progress}</span><button disabled={saving} onClick={() => work.current?.abort()}>{saving ? '保存中' : '取消'}</button></div> : null}
    {error ? <p className="network-error" role="alert">{error}</p> : null}
  </Panel>;
}
