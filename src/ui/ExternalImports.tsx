import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../store/library';

type SharedFile = { id: string; name: string; size: number; open?: boolean; error?: string };
type NativeImports = {
  take: () => string;
  readChunk: (id: string, offset: number) => string;
  release: (id: string) => void;
};
type Job = { name: string; load: () => Promise<File>; open: boolean };

/** Kept mounted across shelf/reader navigation so incoming files are never lost. */
export function ExternalImports({ onOpen }: { onOpen: (id: string) => void }) {
  const ready = useLibrary(st => st.ready);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!ready) return;
    let disposed = false, working = false, depth = 0;
    let hideMessage: ReturnType<typeof setTimeout> | undefined;
    const queue: Job[] = [];
    const drain = async () => {
      if (working || disposed) return;
      working = true; setBusy(true);
      let imported = 0;
      const failures: string[] = [];
      while (queue.length && !disposed) {
        const job = queue.shift()!;
        setMessage(`正在导入：${job.name}`);
        try {
          const file = await job.load();
          if (file.size > 256 * 1024 * 1024) throw new Error('书籍超过 256 MiB');
          const book = await useLibrary.getState().importFile(file);
          imported++;
          if (!disposed && job.open) onOpenRef.current(book.id);
        } catch (error) { failures.push(`${job.name}：${error instanceof Error ? error.message : String(error)}`); }
      }
      working = false;
      if (!disposed) {
        setBusy(false);
        setMessage(`已导入 ${imported} 本${failures.length ? `；${failures.slice(0, 3).join('；')}` : ''}`);
        hideMessage = setTimeout(() => setMessage(''), failures.length ? 12000 : 5000);
      }
    };
    const enqueue = (jobs: Job[]) => {
      if (!jobs.length) return;
      if (hideMessage) clearTimeout(hideMessage);
      queue.push(...jobs); void drain();
    };
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); depth++; setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      if (--depth <= 0) { depth = 0; setDragging(false); }
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); depth = 0; setDragging(false);
      enqueue(Array.from(event.dataTransfer?.files ?? []).map(file => ({ name: file.name, load: async () => file, open: false })));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);

    let unlisten: (() => void) | undefined;
    const native = (window as unknown as { ReadingTreeNativeImports?: NativeImports }).ReadingTreeNativeImports;
    if ('__TAURI_INTERNALS__' in window && !native) {
      void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
        const stop = await getCurrentWebview().onDragDropEvent(event => {
          if (disposed) return;
          setDragging(event.payload.type === 'enter' || event.payload.type === 'over');
          if (event.payload.type !== 'drop') return;
          enqueue(event.payload.paths.map(path => ({
            name: path.split(/[\\/]/).pop() || path, open: false,
            load: async () => {
              const { invoke } = await import('@tauri-apps/api/core');
              const bytes = await invoke<ArrayBuffer>('read_import_file', { path });
              return new File([bytes], path.split(/[\\/]/).pop() || path);
            },
          })));
        });
        if (disposed) stop(); else unlisten = stop;
      }).catch(error => { if (!disposed) setMessage(`拖入导入暂不可用：${String(error)}`); });
    }
    const poll = () => {
      if (!native || disposed) return;
      try {
        const files = JSON.parse(native.take()) as SharedFile[];
        enqueue(files.map(file => ({ name: file.name, open: file.open ?? files.length === 1,
          load: async () => {
            try {
              if (file.error) throw new Error(file.error);
              if (file.size > 256 * 1024 * 1024) throw new Error('书籍超过 256 MiB');
              const chunks: BlobPart[] = [];
              for (let offset = 0; offset < file.size;) {
                const raw = atob(native.readChunk(file.id, offset));
                if (!raw.length) throw new Error('文件读取中断，请重新分享');
                chunks.push(Uint8Array.from(raw, char => char.charCodeAt(0)));
                offset += raw.length;
                // Yield while transferring large books so progress can paint.
                await new Promise(resolve => setTimeout(resolve, 0));
              }
              return new File(chunks, file.name);
            } finally { native.release(file.id); }
          },
        })));
      } catch (error) { setMessage(`接收书籍失败：${String(error)}`); }
    };
    poll();
    const timer = native ? setInterval(poll, 500) : undefined;
    return () => {
      disposed = true; unlisten?.(); clearInterval(timer); clearTimeout(hideMessage);
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop);
    };
  }, [ready]);

  return <>
    {dragging ? <div className="book-drop-overlay"><strong>松开即可导入书籍</strong><span>支持一次拖入多本书</span></div> : null}
    {message ? <div className="external-import-status" role="status"><span>{message}</span>{!busy ? <button onClick={() => setMessage('')}>收起</button> : null}</div> : null}
  </>;
}
