import { useLibrary } from '../store/library';
import { Panel } from './Panel';
/** 本地整库备份/恢复（V0.3.0）：zip 一键导出导入，与 WebDAV 云同步相互独立 */
import { useEffect, useRef, useState } from 'react';
import { storageHealth, type StorageHealth } from '../platform/storageHealth';
import { exportBackup, peekBackup, restoreBackup } from '../backup';

function fmtBytes(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function BackupPanel({ onClose }: { onClose: () => void }) {
  const [storage, setStorage] = useState<StorageHealth | null>(null);
  useEffect(() => { let alive = true; void storageHealth().then(s => { if (alive) setStorage(s); }); return () => { alive = false; }; }, []);
  const [ids] = useState(() => useLibrary.getState().books.map((b) => b.id));
  const [start, setStart] = useState(1);
  const [count, setCount] = useState(100);
  const [nextStart, setNextStart] = useState<number | null>(null);
  const work = useRef<AbortController | null>(null);
  const valid = Number.isInteger(start) && start >= 1 && start <= Math.max(1, ids.length) && Number.isInteger(count) && count >= 1 && count <= 200;
  const [includeRaw, setIncludeRaw] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setErr('');
    setMsg('');
    setBusy(includeRaw ? '正在收集全部数据（含原文件/字体，可能较慢）…' : '正在收集数据…');
    try {
      const controller = new AbortController(); work.current = controller;
      const r = await exportBackup({ includeRaw, ids, start: start - 1, count, signal: controller.signal, onPhase: (p) => setBusy(p.detail) });
      setMsg(`已生成 ${r.books} 本书的备份（${fmtBytes(r.bytes)}）：${r.name}。请确认文件已保存。`);
      setNextStart(start - 1 + r.books < ids.length ? start + r.books : null);
    } catch (e) {
      setErr(work.current?.signal.aborted ? '已取消，本批未导出' : e instanceof Error ? e.message : String(e));
    } finally {
      work.current = null; setBusy('');
    }
  };

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setMsg('');
    try {
      setBusy('正在读取备份包…');
      if (f.size > 68 * 1024 * 1024) throw new Error('备份包过大，请选择较小的分批备份文件');
      const buf = await f.arrayBuffer();
      const info = peekBackup(buf);
      if (
        !window.confirm(
          `该备份包含 ${info.books} 本书（${new Date(info.exportedAt).toLocaleString('zh-CN')} 导出）。\n\n${info.merge ? '这是分批备份，将合并书籍、分类与设置，相同书籍 ID 的内容将被覆盖，其他书籍保留。' : '恢复将【覆盖】当前书库的全部数据（书籍、进度、笔记、分类、设置）。'}确定继续？`,
        )
      ) {
        setBusy('');
        if (fileRef.current) fileRef.current.value = '';
        return;
      }
      const r = await restoreBackup(buf, (p) => setBusy(p.detail));
      window.alert(`恢复完成：${r.books} 本书、${r.kv} 项数据。应用即将刷新。`);
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Panel label="备份与恢复" onClose={() => { if (!busy) onClose(); }}>
        {storage ? <p className="set-hint" role="status">本地已用 {fmtBytes(storage.usage)}{storage.quota ? ` / 可用配额 ${fmtBytes(storage.quota)}` : ''} · {storage.persistent === true ? '已启用持久存储' : '请定期导出备份'}</p> : null}
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => void doImport(e.target.files?.[0])}
        />
        <div className="drawer-head">
          <h3>备份与恢复</h3>
          <button disabled={!!busy} onClick={onClose}>完成</button>
        </div>

        <p className="panel-intro">为书库留一份底稿。</p>
        <p className="set-hint">备份不包含同步账号、密码和设备身份；换机后请重新填写同步连接。</p>
        <div className="set-group">
          <label>备份内容</label>
          <div className="seg">
            <button disabled={!!busy} className={!includeRaw ? 'active' : ''} onClick={() => setIncludeRaw(false)}>
              轻量备份
            </button>
            <button disabled={!!busy} className={includeRaw ? 'active' : ''} onClick={() => setIncludeRaw(true)}>
              完整备份
            </button>
          </div>
          <p className="set-hint">
            {includeRaw ? '包含书籍原文件、字体、进度和笔记，适合换机。' : '保存正文、进度、笔记与设置。PDF 和自定义字体需要选择完整备份。'}
          </p>
        </div>

        <div className="network-range"><label className="network-label">从第几本<input className="field" type="number" min={1} max={Math.max(1, ids.length)} value={start} disabled={!!busy} onChange={(e) => { setStart(Number(e.target.value)); setNextStart(null); }} /></label><label className="network-label">本批数量<input className="field" type="number" min={1} max={200} value={count} disabled={!!busy} onChange={(e) => { setCount(Number(e.target.value)); setNextStart(null); }} /></label></div>
        <p className="set-hint">共 {ids.length} 本，按打开面板时的书籍顺序分批保存。每批最多 200 本、原始数据最多 64 MiB；大文件请减少本数。分批备份可逐包合并恢复，保存一批后再继续下一批。</p>
        {work.current && busy ? <button onClick={() => work.current?.abort()}>取消本批备份</button> : null}
        {nextStart && !busy ? <button onClick={() => { setStart(nextStart); setNextStart(null); }}>准备下一批（从第 {nextStart} 本）</button> : null}
        <button className="primary sync-now" disabled={!!busy || !valid} onClick={() => void doExport()}>
          导出备份
        </button>

        <div className="set-group" style={{ marginTop: 18 }}>
          <label>从备份恢复</label>
          <button className="danger-line" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            选择备份文件并恢复…
          </button>
          <p className="set-hint">整库备份替换现有书库；分批备份合并入架，确认窗口会说明具体方式。</p>
        </div>

        {busy ? <p className="status-message" role="status">{busy}</p> : null}
        {msg ? <p className="status-message" role="status">{msg}</p> : null}
        {err ? <p className="form-error" role="alert">{err}</p> : null}
    </Panel>
  );
}
