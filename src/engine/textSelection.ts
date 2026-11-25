import type { Paginator } from './paginator';

type Point = { x: number; y: number };
type Endpoint = 'start' | 'end';
type PageEnd = { caret: Range; rect: DOMRect; columnLeft: number; columnRight: number };
type Options = {
  stage: HTMLElement;
  rootFor: (node: Node) => HTMLElement | null;
  paginator: () => Paginator | null;
  scrollContainer: () => HTMLElement | null;
  vertical: boolean;
  onChange: (dragging: boolean) => void;
};

/** Own the selection after native long-press/mouse selection. Android's native
 * handles do not emit DOM drag events, so our handles move both the viewport
 * and the actual Range endpoint. The chapter DOM stays intact throughout. */
export class TextSelection {
  private selected: Range | null = null;
  private root: HTMLElement | null = null;
  private overlay = document.createElement('div');
  private paint = document.createElement('div');
  private handles: Record<Endpoint, HTMLButtonElement>;
  private drag: { id: number; fixed: Range; point: Point; offset: Point; side: Endpoint } | null = null;
  private frame = 0;
  private pageEnds: { page: number; first: PageEnd; last: PageEnd } | null = null;
  private turnIntent: { direction: 1 | -1; point: Point } | null = null;
  private afterTurn: { direction: 1 | -1; point: Point } | null = null;
  private lastFrame = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private mouseDown = false;
  private mouseAnchor: { caret: Range; point: Point } | null = null;
  private press: { id: number; point: Point; timer: ReturnType<typeof setTimeout> } | null = null;
  private destroyed = false;
  private observer: MutationObserver;

  constructor(private options: Options) {
    this.overlay.className = 'text-selection-layer';
    this.paint.className = 'text-selection-paint';
    this.paint.setAttribute('aria-hidden', 'true');
    this.overlay.append(this.paint);
    this.handles = { start: this.makeHandle('start'), end: this.makeHandle('end') };
    options.stage.append(this.overlay);
    document.addEventListener('selectionchange', this.nativeChange);
    document.addEventListener('pointerup', this.pointerUp);
    document.addEventListener('pointercancel', this.pointerCancel);
    options.stage.addEventListener('pointerdown', this.nativeDown);
    options.stage.addEventListener('pointermove', this.pressMove);
    options.stage.addEventListener('pointermove', this.mouseMove);
    options.stage.addEventListener('contextmenu', this.contextMenu);
    window.addEventListener('blur', this.cancelDrag);
    document.addEventListener('visibilitychange', this.visibilityChange);
    options.stage.addEventListener('scroll', this.onScroll, true);
    // Font/layout/annotation updates can replace text nodes while a menu is open.
    this.observer = new MutationObserver(() => {
      if (this.selected && (!this.root?.contains(this.selected.startContainer) ||
        !this.root.contains(this.selected.endContainer) || this.selected.collapsed && !this.drag)) this.clear();
    });
    this.observer.observe(options.stage, { childList: true, subtree: true, characterData: true });
    this.render();
  }

  get range(): Range | null { return this.selected?.cloneRange() ?? null; }

  private makeHandle(side: Endpoint): HTMLButtonElement {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = `text-selection-handle ${side}`;
    handle.dataset.endpoint = side;
    handle.setAttribute('aria-label', side === 'start' ? '拖动选区起点' : '拖动选区终点');
    handle.addEventListener('pointerdown', (event) => this.startDrag(event, side));
    handle.addEventListener('pointermove', this.moveDrag);
    handle.addEventListener('lostpointercapture', this.cancelDrag);
    handle.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });
    for (const name of ['touchstart', 'touchmove', 'touchend']) {
      handle.addEventListener(name, (event) => event.stopPropagation());
    }
    this.overlay.append(handle);
    return handle;
  }

  private nativeDown = (event: PointerEvent) => {
    if (!event.isPrimary) { this.cancelPress(); this.cancelDrag(); return; }
    if (event.button !== 0) return;
    const root = this.options.rootFor(event.target as Node);
    if (!root?.contains(event.target as Node)) return;
    if (this.selected) this.clear();
    if (event.pointerType === 'mouse') {
      this.mouseDown = true;
      this.root = root;
      const point = { x: event.clientX, y: event.clientY };
      const caret = this.caretAt(point);
      this.mouseAnchor = caret ? { caret, point } : null;
    }
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    this.cancelPress();
    const point = { x: event.clientX, y: event.clientY };
    this.press = { id: event.pointerId, point, timer: setTimeout(() => {
      this.root = root;
      const caret = this.caretAt(point);
      if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return;
      const node = caret.startContainer as Text;
      if (!node.length) return;
      let offset = Math.min(caret.startOffset, node.length - 1);
      if (offset > 0 && /[\uDC00-\uDFFF]/.test(node.data[offset])) offset--;
      const length = (node.data.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
      caret.setStart(node, offset); caret.setEnd(node, offset + length);
      if (!caret.toString().trim()) return;
      this.selected = caret;
      window.getSelection()?.removeAllRanges();
      this.render(); this.options.onChange(false);
    }, 420) };
  };
  private pressMove = (event: PointerEvent) => {
    if (this.press && (event.pointerId !== this.press.id ||
      Math.hypot(event.clientX - this.press.point.x, event.clientY - this.press.point.y) > 12)) this.cancelPress();
  };
  private cancelPress = () => {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  };
  private mouseMove = (event: PointerEvent) => {
    if (!this.mouseDown || this.drag || event.pointerType !== 'mouse' || !(event.buttons & 1)) return;
    const anchor = this.mouseAnchor;
    if (!anchor || Math.hypot(event.clientX - anchor.point.x, event.clientY - anchor.point.y) < 4) return;
    this.selected = anchor.caret.cloneRange();
    window.getSelection()?.removeAllRanges();
    this.startDrag(event, 'end');
    const drag = this.drag as TextSelection['drag'];
    if (drag) {
      // Mouse coordinates already indicate the caret; no fingertip offset.
      drag.offset = { x: 0, y: 0 };
      this.updateEndpoint();
    }
  };
  private contextMenu = (event: MouseEvent) => {
    if (this.selected || this.press) event.preventDefault();
  };

  private nativeChange = () => {
    if (this.drag || this.destroyed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.mouseDown) this.capture(); }, 280);
  };

  /** Called after native selection settles; clearing it also dismisses native handles. */
  capture(): void {
    if (this.drag || this.destroyed) return;
    const native = window.getSelection();
    if (!native?.rangeCount || native.isCollapsed) return;
    const range = native.getRangeAt(0).cloneRange();
    const root = this.options.rootFor(range.startContainer);
    if (!root?.contains(range.startContainer)) return;
    if (!root.contains(range.endContainer)) range.setEnd(root, root.childNodes.length);
    if (!range.toString().trim()) return;
    this.root = root;
    this.selected = range;
    native.removeAllRanges();
    this.options.paginator()?.lockViewport();
    this.render();
    this.options.onChange(false);
  }

  private viewport(): DOMRect {
    const stage = this.options.stage;
    const clip = stage.querySelector<HTMLElement>('.page-clip');
    if (this.options.vertical && clip) return clip.getBoundingClientRect();
    const outer = stage.querySelector<HTMLElement>('.page-outer, .scroll-outer') ?? stage;
    const r = outer.getBoundingClientRect();
    const s = getComputedStyle(outer);
    const left = parseFloat(s.paddingLeft) || 0, right = parseFloat(s.paddingRight) || 0;
    const top = parseFloat(s.paddingTop) || 0, bottom = parseFloat(s.paddingBottom) || 0;
    // The paginator adds a trailing column gap to paddingRight so the final
    // page can scroll fully into view. That spacer is not a reading margin.
    // Subtracting it here clipped both painted selections and caret hit tests.
    const inner = outer.querySelector<HTMLElement>('.page-inner');
    const scale = outer.clientWidth ? r.width / outer.clientWidth : 1;
    const contentWidth = inner ? parseFloat(getComputedStyle(inner).width) * scale : NaN;
    const width = Number.isFinite(contentWidth)
      ? Math.min(contentWidth, r.width - left * scale)
      : r.width - (left + right) * scale;
    return new DOMRect(r.left + left * scale, r.top + top * scale, width, r.height - (top + bottom) * scale);
  }

  private endpoint(side: Endpoint): Point | null {
    if (!this.selected) return null;
    const caret = this.selected.cloneRange();
    caret.collapse(side === 'start');
    const r = caret.getClientRects()[0];
    if (!r) return null;
    return this.options.vertical ? { x: r.left, y: r.top } : { x: r.left, y: r.bottom };
  }

  private render(): void {
    this.overlay.hidden = !this.selected;
    this.options.stage.classList.toggle('text-selecting', !!this.selected);
    if (!this.selected) { this.paint.replaceChildren(); return; }
    const view = this.viewport();
    const stage = this.options.stage.getBoundingClientRect();
    const fragment = document.createDocumentFragment();
    const textRects: DOMRect[] = [];
    const walker = document.createTreeWalker(this.root!, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!this.selected.intersectsNode(node)) continue;
      const text = node as Text, part = document.createRange();
      part.setStart(text, node === this.selected.startContainer ? this.selected.startOffset : 0);
      part.setEnd(text, node === this.selected.endContainer ? this.selected.endOffset : text.length);
      if (!part.collapsed) textRects.push(...part.getClientRects());
    }
    for (const r of textRects) {
      const left = Math.max(r.left, view.left), right = Math.min(r.right, view.right);
      const top = Math.max(r.top, view.top), bottom = Math.min(r.bottom, view.bottom);
      if (right <= left || bottom <= top) continue;
      const rect = document.createElement('span');
      Object.assign(rect.style, { left: `${left - stage.left}px`, top: `${top - stage.top}px`,
        width: `${right - left}px`, height: `${bottom - top}px` });
      fragment.append(rect);
    }
    this.paint.replaceChildren(fragment);
    for (const side of ['start', 'end'] as const) {
      const point = this.endpoint(side);
      const handle = this.handles[side];
      handle.hidden = !point;
      if (!point) continue;
      const x = Math.max(view.left, Math.min(view.right, point.x));
      const y = Math.max(view.top, Math.min(view.bottom, point.y));
      handle.dataset.offscreen = String(x !== point.x || y !== point.y);
      handle.style.left = `${x - stage.left}px`;
      handle.style.top = `${y - stage.top}px`;
    }
  }

  private startDrag(event: PointerEvent, side: Endpoint): void {
    if (!this.selected || !(event.buttons & 1) || !event.isPrimary) return;
    event.preventDefault(); event.stopPropagation();
    if (this.timer) clearTimeout(this.timer);
    const fixed = this.selected.cloneRange();
    fixed.collapse(side !== 'start');
    const point = this.endpoint(side);
    const view = this.viewport();
    // Keep the caret above the fingertip instead of selecting the line below the knob.
    const x = Math.max(view.left, Math.min(view.right, point?.x ?? event.clientX));
    const y = Math.max(view.top, Math.min(view.bottom, point?.y ?? event.clientY));
    this.drag = { id: event.pointerId, fixed, side, point: { x: event.clientX, y: event.clientY },
      offset: { x: x - event.clientX + (this.options.vertical ? 4 : 0),
        y: y - event.clientY - (this.options.vertical ? 0 : 4) } };
    this.handles[side].setPointerCapture(event.pointerId);
    this.overlay.dataset.dragging = 'true';
    this.pageEnds = null; this.turnIntent = null; this.afterTurn = null; this.lastFrame = 0;
    this.considerPageTurn({ x: event.clientX + this.drag.offset.x, y: event.clientY + this.drag.offset.y });
    this.options.onChange(true);
    if (!this.options.paginator()) this.frame = requestAnimationFrame(this.tick);
  }

  private moveDrag = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    event.preventDefault(); event.stopPropagation();
    this.drag.point = { x: event.clientX, y: event.clientY };
    const point = { x: event.clientX + this.drag.offset.x, y: event.clientY + this.drag.offset.y };
    if (this.afterTurn) {
      const view = this.viewport(), ends = this.measurePageEnds();
      const moved = Math.hypot(point.x - this.afterTurn.point.x, point.y - this.afterTurn.point.y) >= 12;
      const inside = point.x >= view.left && point.x <= view.right && point.y >= view.top && point.y <= view.bottom;
      // A stationary finger (or edge jitter) must never select/turn another page.
      // Return into the new page to resume choosing its words.
      const away = ends && (this.afterTurn.direction > 0
        ? (this.options.vertical ? point.y < ends.last.rect.bottom - 36 : point.y < ends.last.rect.top - 12)
        : (this.options.vertical ? point.y > ends.first.rect.top + 36 : point.y > ends.first.rect.bottom + 12));
      if (!moved || !inside || !away) return;
      this.afterTurn = null;
    }
    this.updateEndpoint();
    this.considerPageTurn(point);
  };

  /** First/last visible text fragments in reading order, including the final
   * column of a two-column spread. Cache only for the current stable page. */
  private measurePageEnds(): typeof this.pageEnds {
    const pag = this.options.paginator();
    if (!pag || !this.root) return null;
    if (this.pageEnds?.page === pag.page) return this.pageEnds;
    const view = this.viewport();
    let first: DOMRect | null = null, last: DOMRect | null = null;
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        const left = Math.max(view.left, rect.left), right = Math.min(view.right, rect.right);
        const top = Math.max(view.top, rect.top), bottom = Math.min(view.bottom, rect.bottom);
        if (right - left < 1 || bottom - top < 1) continue;
        const visible = new DOMRect(left, top, right - left, bottom - top);
        first ??= visible; last = visible;
      }
    }
    if (!first || !last) return null;
    const style = getComputedStyle(this.root);
    const column = parseFloat(style.columnWidth) || view.width;
    const gap = parseFloat(style.columnGap) || 0;
    const end = (rect: DOMRect, atStart: boolean): PageEnd | null => {
      const caret = this.caretAt(this.options.vertical
        ? { x: rect.left + rect.width / 2, y: atStart ? rect.top + .5 : rect.bottom - .5 }
        : { x: atStart ? rect.left + .5 : rect.right - .5, y: rect.top + rect.height / 2 });
      if (!caret) return null;
      const columnLeft = view.left + Math.floor((rect.left - view.left + 1) / (column + gap)) * (column + gap);
      return { caret, rect, columnLeft, columnRight: Math.min(view.right, columnLeft + column) };
    };
    const a = end(first, true), b = end(last, false);
    this.pageEnds = a && b ? { page: pag.page, first: a, last: b } : null;
    return this.pageEnds;
  }

  /** Page turns require two distinct gestures: reach the terminal line, then
   * drag past it. Time spent at an edge is never interpreted as further intent. */
  private considerPageTurn(point: Point): void {
    const pag = this.options.paginator(), ends = this.measurePageEnds();
    if (!pag || !ends || !this.drag || this.afterTurn) return;
    const near = (end: PageEnd, direction: 1 | -1) => this.options.vertical
      ? point.x >= end.rect.left - 4 && point.x <= end.rect.right + 4 &&
        (direction > 0 ? point.y >= end.rect.bottom - 24 && point.y <= end.rect.bottom + 4
          : point.y >= end.rect.top - 4 && point.y <= end.rect.top + 24)
      : point.x >= end.columnLeft - 12 && point.x <= end.columnRight + 12 &&
        point.y >= end.rect.top - 10 && point.y <= end.rect.bottom + 12;
    if (this.turnIntent) {
      const { direction, point: entered } = this.turnIntent;
      const end = direction > 0 ? ends.last : ends.first;
      const beyond = direction > 0
        ? point.y > end.rect.bottom + 10 && point.y - entered.y >= (this.options.vertical ? 12 : 16)
        : point.y < end.rect.top - 10 && entered.y - point.y >= (this.options.vertical ? 12 : 16);
      const withinColumn = this.options.vertical
        ? point.x >= end.rect.left - 4 && point.x <= end.rect.right + 4
        : point.x >= end.columnLeft - 12 && point.x <= end.columnRight + 12;
      const sideways = this.options.vertical && (direction > 0
        ? point.x < end.rect.left - 10 && entered.x - point.x >= 12 && point.y >= end.rect.bottom - 24
        : point.x > end.rect.right + 10 && point.x - entered.x >= 12 && point.y <= end.rect.top + 24);
      if (beyond && withinColumn || sideways) {
        const moved = direction > 0 ? pag.next() : pag.prev();
        this.turnIntent = null;
        if (moved) {
          this.pageEnds = null;
          this.afterTurn = { direction, point };
          const next = this.measurePageEnds();
          // Start at the new page's boundary, not halfway down under the old
          // finger position. Releasing here does not add a whole extra page.
          this.updateEndpoint(next ? (direction > 0 ? next.first.caret : next.last.caret) : end.caret);
        }
        return;
      }
      if (near(end, direction)) return;
      // Preserve intent through the small distance between the line and the
      // threshold. Slow, finely sampled drags must work just like touch moves.
      const approaching = this.options.vertical
        ? (direction > 0 ? point.y >= end.rect.bottom - 24 && point.x >= end.rect.left - 10 && point.x <= end.rect.right + 4
          : point.y <= end.rect.top + 24 && point.x >= end.rect.left - 4 && point.x <= end.rect.right + 10)
        : withinColumn && (direction > 0 ? point.y >= end.rect.top - 10 : point.y <= end.rect.bottom + 12);
      if (approaching) return;
      this.turnIntent = null;
    }
    if (near(ends.last, 1)) this.turnIntent = { direction: 1, point };
    else if (near(ends.first, -1)) this.turnIntent = { direction: -1, point };
  }

  private caretAt(point: Point): Range | null {
    if (!this.root) return null;
    const view = this.viewport();
    const x = Math.max(view.left + 1, Math.min(view.right - 1, point.x));
    const y = Math.max(view.top + 1, Math.min(view.bottom - 1, point.y));
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
    const caret = doc.caretRangeFromPoint?.(x, y);
    if (caret && caret.startContainer.nodeType === Node.TEXT_NODE && this.root.contains(caret.startContainer)) return caret;
    // Gaps between paragraphs/columns can hit an element instead of a text node.
    // Choose the nearest visible glyph; never guess a character count.
    let closest: Range | null = null, best = Infinity;
    const distance = (r: DOMRect) => Math.max(r.left - x, 0, x - r.right) ** 2 + Math.max(r.top - y, 0, y - r.bottom) ** 2;
    const visible = (r: DOMRect) => r.right > view.left && r.left < view.right && r.bottom > view.top && r.top < view.bottom;
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      const range = document.createRange(); range.selectNodeContents(text);
      if (!Array.from(range.getClientRects()).some((r) => visible(r) && distance(r) <= best)) continue;
      let offset = 0;
      for (const char of text.data) {
        range.setStart(text, offset); range.setEnd(text, offset + char.length);
        const r = range.getBoundingClientRect(), d = distance(r);
        if (visible(r) && d < best) {
          best = d; closest = range.cloneRange();
          closest.collapse(this.options.vertical ? y < (r.top + r.bottom) / 2 : x < (r.left + r.right) / 2);
        }
        offset += char.length;
      }
    }
    return closest;
  }

  private updateEndpoint(target?: Range): void {
    const drag = this.drag;
    if (!drag || this.afterTurn && !target) return;
    const caret = target ?? this.caretAt({ x: drag.point.x + drag.offset.x, y: drag.point.y + drag.offset.y });
    if (!caret) return;
    const range = document.createRange();
    const earlier = caret.compareBoundaryPoints(Range.START_TO_START, drag.fixed) < 0;
    const start = earlier ? caret : drag.fixed, end = earlier ? drag.fixed : caret;
    range.setStart(start.startContainer, start.startOffset);
    range.setEnd(end.startContainer, end.startOffset);
    this.selected = range;
    this.render();
  }

  private tick = (now: number) => {
    this.frame = 0;
    const drag = this.drag;
    if (!drag) return;
    const view = this.viewport();
    const dt = Math.min(40, this.lastFrame ? now - this.lastFrame : 16);
    this.lastFrame = now;
    if (!this.options.paginator()) {
      const scroll = this.options.scrollContainer();
      const y = drag.point.y;
      const speed = y < view.top + 36 ? -0.3 : y > view.bottom - 36 ? 0.3 : 0;
      if (scroll && speed) { scroll.scrollTop += dt * speed; this.updateEndpoint(); }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private pointerUp = (event: PointerEvent) => {
    this.cancelPress();
    this.mouseDown = false;
    this.mouseAnchor = null;
    if (this.drag?.id === event.pointerId) {
      event.preventDefault();
      this.drag.point = { x: event.clientX, y: event.clientY };
      this.updateEndpoint(); this.cancelDrag();
    } else this.capture();
  };
  private pointerCancel = () => { this.cancelPress(); this.mouseDown = false; this.cancelDrag(); this.nativeChange(); };
  private visibilityChange = () => { if (document.hidden) this.cancelDrag(); };
  private onScroll = () => { if (this.selected) this.render(); };
  private cancelDrag = () => {
    this.mouseDown = false;
    this.mouseAnchor = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0; this.turnIntent = null; this.pageEnds = null;
    if (!this.drag) return;
    const drag = this.drag; this.drag = null;
    this.afterTurn = null;
    const handle = this.handles[drag.side];
    if (handle.hasPointerCapture(drag.id)) handle.releasePointerCapture(drag.id);
    delete this.overlay.dataset.dragging;
    this.render();
    this.options.onChange(false);
  };

  clear(): void {
    this.cancelPress();
    this.cancelDrag();
    if (this.timer) clearTimeout(this.timer);
    this.selected = null; this.root = null;
    window.getSelection()?.removeAllRanges();
    this.render(); this.options.onChange(false);
  }

  destroy(): void {
    this.destroyed = true;
    this.clear(); this.observer.disconnect(); this.overlay.remove();
    document.removeEventListener('selectionchange', this.nativeChange);
    document.removeEventListener('pointerup', this.pointerUp);
    document.removeEventListener('pointercancel', this.pointerCancel);
    this.options.stage.removeEventListener('pointerdown', this.nativeDown);
    this.options.stage.removeEventListener('pointermove', this.pressMove);
    this.options.stage.removeEventListener('pointermove', this.mouseMove);
    this.options.stage.removeEventListener('contextmenu', this.contextMenu);
    this.options.stage.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('blur', this.cancelDrag);
    document.removeEventListener('visibilitychange', this.visibilityChange);
  }
}
