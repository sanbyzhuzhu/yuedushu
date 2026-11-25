/** 书籍信息编辑（V0.3.0，参考 Anx/Readest 的 book info 编辑）：书名 / 作者 / 分类 / 封面 */
import { useEffect, useRef, useState } from 'react';
import { platform } from '../platform/web';
import { useLibrary } from '../store/library';
import type { BookMeta, CatNode } from '../engine/types';

async function fileToCoverDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('图片无法读取'));
      im.src = url;
    });
    const max = 480;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * scale));
    cv.height = Math.max(1, Math.round(img.height * scale));
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BookEditPanel({
  book,
  nodes,
  onClose,
}: {
  book: BookMeta;
  nodes: CatNode[];
  onClose: () => void;
}) {
  const saveBookInfo = useLibrary((st) => st.saveBookInfo);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [nodeId, setNodeId] = useState<string>(book.nodeId ?? '');
  const [cover, setCoverState] = useState<string | undefined>(book.cover);
  const [coverChanged, setCoverChanged] = useState(false);
  const [coverLoading, setCoverLoading] = useState(!!book.hasCover && !book.cover);
  useEffect(() => { let alive = true; if (book.hasCover && !book.cover) void platform.getCover(book.id).then((value) => { if (alive) setCoverState(value); }).catch(() => { if (alive) setErr('封面暂时无法读取，原封面仍会保留'); }).finally(() => { if (alive) setCoverLoading(false); }); return () => { alive = false; }; }, [book.id, book.hasCover, book.cover]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickCover = async (f: File | undefined) => {
    if (!f) return;
    try {
      setCoverState(await fileToCoverDataUrl(f)); setCoverChanged(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '封面处理失败');
      setTimeout(() => setErr(''), 3000);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async () => {
    if (saving) return;
    if (!title.trim()) { setErr('请填写书名'); return; }
    setSaving(true); setErr('');
    try {
    await saveBookInfo(book.id, {
      title: title.trim() || book.title,
      author: author.trim(),
      ...(coverChanged ? { cover: cover ?? null } : {}),
      nodeId: nodeId || null,
    });
    onClose();
    } catch { setErr('保存失败，修改仍保留在这里。'); }
    finally { setSaving(false); }
  };

  return (
    <div className="drawer-mask" onClick={() => { if (!saving) onClose(); }}>
      <div className="edit-card" role="dialog" aria-modal="true" aria-label="编辑书籍信息" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>编辑书籍信息</h3>
          <button onClick={() => { if (!saving) onClose(); }}>取消</button>
        </div>

        <div className="edit-body">
          <div className="edit-cover">
            <div className="cover preview" style={cover ? undefined : { background: '#2C5F7C', color: '#EAF1F5' }}>
              {cover ? (
                <img className="cover-img" src={cover} alt="" />
              ) : (
                <span className="cover-title">{title.slice(0, 6) || '书名'}</span>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pickCover(e.target.files?.[0])} />
            <button disabled={coverLoading} onClick={() => fileRef.current?.click()}>更换封面</button>
            {cover ? (
              <button className="link-btn" disabled={coverLoading} onClick={() => { setCoverState(undefined); setCoverChanged(true); }}>
                清除封面
              </button>
            ) : null}
          </div>

          <div className="edit-fields">
            <label className="set-group">
              <span className="edit-label">书名</span>
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="set-group">
              <span className="edit-label">作者</span>
              <input className="field" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="佚名" />
            </label>
            <label className="set-group">
              <span className="edit-label">分类</span>
              <select className="field" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
                <option value="">未分类</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            {err ? <p className="set-hint">{err}</p> : null}
          </div>
        </div>

        <button disabled={saving} className="primary edit-save" onClick={() => void save()}>
          {saving ? '正在保存…' : '保存书籍信息'}
        </button>
      </div>
    </div>
  );
}
