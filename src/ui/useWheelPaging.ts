import { useEffect, useRef, type RefObject } from 'react';

/** One page per wheel/trackpad burst; scroll reading and selection keep their own gestures. */
export function useWheelPaging(stage: RefObject<HTMLElement>, canTurn: () => boolean,
  next: () => void, previous: () => void) {
  const gesture = useRef({ total: 0, lastAt: 0, turned: false });
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const state = gesture.current;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.buttons || !canTurn()) {
        state.total = 0; state.turned = false; return;
      }
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!delta) return;
      event.preventDefault();
      const now = performance.now();
      if (now - state.lastAt > 180) { state.total = 0; state.turned = false; }
      state.lastAt = now;
      if (state.turned) return;
      const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      if (Math.sign(pixels) !== Math.sign(state.total)) state.total = 0;
      state.total += pixels;
      if (Math.abs(state.total) < 40) return;
      state.turned = true;
      if (state.total > 0) next(); else previous();
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [stage, canTurn, next, previous]);
}
