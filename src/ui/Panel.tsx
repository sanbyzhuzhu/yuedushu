import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { registerBackHandler } from '../platform/backHandler';

/** 通用面板：统一遮罩、焦点、键盘关闭和手机安全区。 */
export function Panel({ children, label, side = 'right', onClose }: {
  children: ReactNode;
  label: string;
  side?: 'left' | 'right';
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => registerBackHandler(() => { close.current(); return true; }), []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  return (
    <div className="drawer-mask" onClick={() => close.current()}>
      <aside ref={ref} className={`drawer ${side}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); close.current(); }
          if (e.key !== 'Tab') return;
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="hidden"]):not(:disabled), textarea, select, summary, [tabindex="0"]'))
            .filter((el) => el.getClientRects().length > 0);
          const first = items[0], last = items[items.length - 1];
          if (!first) { e.preventDefault(); return; }
          if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); }
        }}>
        {children}
      </aside>
    </div>
  );
}
