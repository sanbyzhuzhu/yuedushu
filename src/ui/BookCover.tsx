import { useEffect, useRef, useState } from 'react';
import { platform } from '../platform/web';
import type { BookMeta } from '../engine/types';

/** Only visible covers (and a small scroll margin) are read from IndexedDB. */
export function BookCover({ book, background, color }: { book: BookMeta; background: string; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState(book.cover);
  useEffect(() => {
    let alive = true; setCover(book.cover);
    if (!book.hasCover || book.cover || !ref.current) return;
    const load = () => { void platform.getCover(book.id).then((url) => { if (alive) setCover(url); }).catch(() => {}); };
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); load(); } }, { rootMargin: '300px' });
    observer.observe(ref.current);
    return () => { alive = false; observer.disconnect(); };
  }, [book.id, book.cover, book.hasCover, book.updatedAt]);
  return <div ref={ref} className="cover" style={cover ? undefined : { background, color }}>
    {cover ? <img className="cover-img" src={cover} alt="" loading="lazy" decoding="async" /> : <><span className="cover-title">{book.title}</span>{book.author ? <span className="cover-author">{book.author}</span> : null}</>}
  </div>;
}
