/**
 * 分页引擎（V0.0.3/V0.0.4 核心，V0.2.2 竖排重写）
 *
 * 横排 horizontal-tb：CSS 多栏 + 滚动窗口分页。
 * - 栏自左向右溢出，外层 LTR 滚动容器，next = scrollBy(+step)
 *
 * 竖排 vertical-rl：自然换行 + transform 平移分页。
 * - 实测 Chromium 的 vertical-rl multicol 溢出方向是"向下"（inline 轴）而非向左，
 *   无法用于横向分页 → 改用：内框 width:max-content 承载整章全部"行"（一行=一栏，
 *   行距=节距，强制整数像素保证网格均匀），翻页 = translateX(±步长)。
 * - 翻页方向规则（方案 5.1）：竖排 RTL：下一页在左（由 UI 层映射点击/手势区域）。
 */

export type Flow = 'horizontal' | 'vertical';

export interface PageGeometry {
  pageW: number;
  pageH: number;
  gap: number;
  flow: Flow;
  colsPerPage?: 1 | 2; // 双页对开（仅横排）
  /** 左右页边距（px） */
  insetX?: number;
  /** 上下页边距（px） */
  insetY?: number;
  /** 竖排版框内的上下留白；不移动界行和版框。 */
  framePadding?: number;
  /** 竖排：一栏宽度（=行距节距 字号×行距，整数 px）；横排忽略 */
  colW?: number;
}

export class Paginator {
  private outer: HTMLElement;
  private clip: HTMLElement;
  private inner: HTMLElement;
  private geom: PageGeometry = { pageW: 0, pageH: 0, gap: 40, flow: 'horizontal' };
  private cols = 1;
  private colW = 0;
  private step = 0;
  private padL = 0;
  private padR = 0;
  private vertical = false;
  private _page = 0;
  private _pages = 1;
  /** 竖排连续微滚的亚像素偏移：拖选跨界时不能整页跳，否则一次跳过一整页内容 */
  private pan = 0;
  private onChange: ((page: number, pages: number) => void) | null = null;

  constructor(outer: HTMLElement, clip: HTMLElement, inner: HTMLElement) {
    this.outer = outer;
    this.clip = clip;
    this.inner = inner;
    this.outer.style.overflow = 'hidden';
  }

  setOnChange(cb: (page: number, pages: number) => void): void {
    this.onChange = cb;
  }

  /** 应用页面几何与排版方向；内容重排后需调 relayout() */
  setGeometry(geom: PageGeometry): void {
    this.geom = geom;
    const { pageW, pageH, gap, flow, colsPerPage = 1, insetX = 0, insetY = 0, framePadding = 0, colW } = geom;
    this.vertical = flow === 'vertical';
    const ix = Math.max(0, Math.round(insetX));
    const iy = Math.max(0, Math.round(insetY));
    this.outer.style.direction = this.vertical ? 'rtl' : 'ltr';
    const s = this.inner.style;
    s.direction = 'ltr'; // 内容自身保持 LTR 基方向，保证中西混排 bidi 正确

    if (this.vertical) {
      this.outer.style.clipPath = '';
      // 竖排：一行 = 一栏，栏宽 = 行距节距；内框 max-content 承载整章，transform 翻页。
      // 实测 Chromium vertical-rl multicol 溢出方向为"向下"，无法横向分页，故弃用。
      this.colW = Math.max(12, Math.round(colW ?? pageW / 8));
      this.cols = Math.max(1, Math.floor((pageW + 1) / this.colW));
      this.step = this.cols * this.colW;
      // 零头吸收：窗口(pageW)不是节距整倍数时，多出的部分划到裁剪层之外（纸边），
      // 裁剪层宽度恰为 cols×pitch 整倍数——栏位网格与窗口严格对齐
      const slack = Math.max(0, pageW - this.cols * this.colW);
      this.padL = 0;
      this.padR = 0;
      this.outer.style.padding = '0px';
      const c = this.clip.style;
      c.display = 'block'; // 覆盖默认的 display:contents，成为真实裁剪盒
      c.position = 'absolute';
      c.overflow = 'hidden';
      c.top = `${iy}px`;
      c.bottom = `${iy}px`;
      c.right = `${ix}px`;
      c.left = `${ix + slack}px`;
      s.position = 'absolute';
      const bodyInset = Math.max(0, Math.min(Math.round(framePadding), pageH / 4));
      s.top = `${bodyInset}px`;
      s.right = '0px';
      // 界行/版框装饰用的几何变量（CSS 消费）
      this.outer.style.setProperty('--pitch', `${this.colW}px`);
      this.outer.style.setProperty('--insetX', `${ix}px`);
      this.outer.style.setProperty('--insetY', `${iy}px`);
      this.outer.style.setProperty('--slack', `${slack}px`);
      s.writingMode = 'vertical-rl';
      s.width = 'max-content';
      s.height = (pageH - bodyInset * 2) + 'px';
      s.columnWidth = 'auto';
      s.columnGap = 'normal';
      s.columnFill = 'balance';
    } else {
      this.cols = Math.max(1, colsPerPage);
      const bodyInset = Math.max(0, Math.min(Math.round(framePadding), pageW / 8, pageH / 8));
      const bodyW = pageW - bodyInset * 2;
      // 双栏时单栏宽减去栏间距
      this.colW = this.cols === 2 ? Math.max(40, (bodyW - gap) / this.cols) : bodyW;
      this.step = this.cols * (this.colW + gap);
      this.padL = ix + bodyInset;
      // 留出末页后的栏间距，使 scrollLeft 能到达完整的 page×step，避免末页被夹在两页之间。
      this.padR = ix + bodyInset + gap;
      this.outer.style.padding = `${iy + bodyInset}px ${this.padR}px ${iy + bodyInset}px ${this.padL}px`;
      // Hide neighbouring columns in the paper margin, even with generous margins/frames.
      this.outer.style.clipPath = `inset(0 ${ix}px)`;
      // 横排：恢复裁剪层透传（display:contents 由 CSS 类提供），布局与旧版一致
      const c = this.clip.style;
      c.display = '';
      c.position = '';
      c.overflow = '';
      c.top = '';
      c.bottom = '';
      c.right = '';
      c.left = '';
      s.position = '';
      s.top = '';
      s.right = '';
      this.outer.style.setProperty('--pitch', `${this.colW}px`);
      this.outer.style.setProperty('--insetX', `${ix}px`);
      this.outer.style.setProperty('--insetY', `${iy}px`);
      this.outer.style.setProperty('--slack', '0px');
      s.writingMode = 'horizontal-tb';
      s.width = bodyW + 'px';
      s.height = (pageH - bodyInset * 2) + 'px';
      s.columnWidth = this.colW + 'px';
      s.columnGap = gap + 'px';
      s.columnFill = 'auto';
      s.transform = 'none';
    }
  }

  /** 仅设置内容 HTML（不测量）；配合 relayout() 使用，便于两者之间注入划线标记 */
  setHtml(html: string): void {
    this.inner.innerHTML = html;
  }

  /** 载入一章并测量总页数；页码归零 */
  setContent(html: string): number {
    this.setHtml(html);
    return this.relayout();
  }

  /** 重测页数（窗口尺寸/排版参数变化后调用），页码尽量保留由调用方 goTo 恢复 */
  relayout(): number {
    this.outer.querySelector('[data-page-spacer]')?.remove();
    this.outer.scrollTo({ left: 0 });
    let totalCols: number;
    if (this.vertical) {
      // 内框 max-content：scrollWidth 即整章所有行的总宽（行距节距均匀）
      const totalW = Math.max(this.colW, this.inner.scrollWidth);
      totalCols = Math.max(1, Math.round(totalW / this.colW));
      // 节距自检：列带宽度应恰为节距整倍数（块级 margin 已在 CSS 归零）；
      // ≤2px 属 max-content 亚像素累计（每列 ~0.03px，无害），更大偏差说明网格被破坏
      const rem = totalW % this.colW;
      if (rem > 2 && rem < this.colW - 2) {
        console.warn(`[paginator] 竖排列带宽 ${totalW}px 非节距 ${this.colW}px 整倍数（余 ${rem}px），网格被块级元素破坏`);
      }
    } else {
      // scrollWidth 含外层左右内边距，需扣除后才是 N 栏正文宽度
      const { gap } = this.geom;
      const sw = Math.max(0, this.outer.scrollWidth - this.padL - this.padR);
      totalCols = Math.max(1, Math.round((sw + gap) / (this.colW + gap)));
    }
    this._pages = Math.max(1, Math.ceil(totalCols / this.cols));
    if (!this.vertical) {
      const spacer = document.createElement('span');
      spacer.dataset.pageSpacer = 'true';
      spacer.setAttribute('aria-hidden', 'true');
      Object.assign(spacer.style, { position: 'absolute', pointerEvents: 'none', width: '1px', height: '1px',
        left: `${(this._pages - 1) * this.step + this.outer.clientWidth - 1}px`, top: '0' });
      this.outer.appendChild(spacer);
    }
    this._page = 0;
    this.pan = 0;
    this.applyOffset();
    this.emit();
    return this._pages;
  }

  get page(): number {
    return this._page;
  }

  get pages(): number {
    return this._pages;
  }

  goTo(p: number): void {
    const target = Math.max(0, Math.min(this._pages - 1, Math.round(p)));
    if (target !== this._page || this.vertical || this.pan || this.outer.scrollLeft !== target * this.step) {
      this._page = target;
      this.pan = 0;
      this.applyOffset();
      this.emit();
    }
  }

  /** 原生拖选可能滚动隐藏容器；分页只响应明确的导航。 */
  lockViewport(): void {
    const left = this.vertical ? 0 : this._page * this.step;
    if (this.outer.scrollLeft !== left) this.outer.scrollLeft = left;
    if (this.outer.scrollTop) this.outer.scrollTop = 0;
    if (this.clip.scrollLeft) this.clip.scrollLeft = 0;
    if (this.clip.scrollTop) this.clip.scrollTop = 0;
  }

  /** 将正文矩形定位到完整页面，支持竖排和双栏。 */
  revealRect(rect: DOMRect): void {
    if (this.step <= 0) return;
    const bounds = this.outer.getBoundingClientRect();
    const scale = bounds.width / this.outer.clientWidth || 1;
    const offset = this.vertical
      ? (bounds.right - rect.right) / scale - (this.geom.insetX ?? 0) + this._page * this.step
      : (rect.left - bounds.left) / scale - this.padL + this.outer.scrollLeft;
    this.goTo(Math.floor(Math.max(0, offset + 1) / this.step));
  }

  /** 应用页码对应的视口偏移：竖排 transform 平移；横排绝对滚动（外层为 LTR，scrollLeft=页×步长） */
  private applyOffset(): void {
    if (this.vertical) {
      this.inner.style.transform = `translateX(${this._page * this.step + this.pan}px)`;
    } else {
      this.outer.scrollTo({ left: this._page * this.step });
    }
  }

  /** 从实际滚动位置反推页码（横排连续微滚后同步页码显示） */
  private syncFromScroll(): void {
    if (this.vertical || this.step <= 0) return;
    const p = Math.max(0, Math.min(this._pages - 1, Math.round(this.outer.scrollLeft / this.step)));
    if (p !== this._page) {
      this._page = p;
      this.emit();
    }
  }

  /** 拖选划线时的连续微滚（V0.3.5）
   *
   *  分页容器是 overflow:hidden，浏览器原生的"拖选到边缘自动滚动"完全失效——
   *  整章内容虽都在 DOM 里（横排多栏），视口外的部分手指够不着，跨页根本划不上。
   *  这里按手指贴近边缘的程度做小幅连续位移：dx>0 向内容后方，dx<0 向前方。
   *  关键是只移动视口、不动 DOM，因此 Range 选区不会被打断。
   *  竖排累积满一整页时归一化进 _page，横排直接由 scrollLeft 反推页码。 */
  panBy(dx: number): void {
    if (!dx) return;
    if (this.vertical) {
      const max = Math.max(0, (this._pages - 1) * this.step);
      const cur = this._page * this.step + this.pan;
      const next = Math.max(0, Math.min(max, cur + dx));
      this.pan = next - this._page * this.step;
      if (Math.abs(this.pan) >= this.step) {
        const k = Math.trunc(this.pan / this.step);
        this._page = Math.max(0, Math.min(this._pages - 1, this._page + k));
        this.pan -= k * this.step;
        this.emit();
      }
      this.applyOffset();
    } else {
      this.outer.scrollBy({ left: dx });
      this.syncFromScroll();
    }
  }

  /** 当前是否还能向内容后方微滚（用于边缘自动滚动的边界判定） */
  canPanForward(): boolean {
    if (this.vertical) return this._page * this.step + this.pan < (this._pages - 1) * this.step;
    return this.outer.scrollLeft < this.outer.scrollWidth - this.outer.clientWidth - 1;
  }

  /** 当前是否还能向内容前方微滚 */
  canPanBack(): boolean {
    if (this.vertical) return this._page * this.step + this.pan > 0;
    return this.outer.scrollLeft > 1;
  }

  /** 微滚结束后只同步页码，绝不移动视口（V0.3.5 修订）
   *
   *  旧实现会把视口吸附/回弹对齐到整页，实测就是"跨页划着划着突然跳到章节前面去"：
   *  ① 竖排的 k 算错——pan=-250、step=400 时 trunc(-0.625)=0 再 -1 得 k=-1，
   *     一次性往回跨一整页，且残留位移被丢弃；
   *  ② 未过半时 pan 归零再 applyOffset，视口整段弹回原页；
   *  ③ 横排同理，scrollTo(page×step) 会把不足一页的位移直接抹掉。
   *  正确做法是保持当前滚动位置不动（next/prev/goTo 时自然会重新对齐），
   *  只把页码显示同步过来——竖排已在 panBy 里做过满页归一化，页码本来就是准的。 */
  settlePan(): void {
    this.syncFromScroll();
  }

  /** 下一页；已在末页返回 false（由调用方切换章节） */
  next(): boolean {
    if (this._page >= this._pages - 1) return false;
    this.goTo(this._page + 1);
    return true;
  }

  /** 上一页；已在首页返回 false */
  prev(): boolean {
    if (this._page <= 0) return false;
    this.goTo(this._page - 1);
    return true;
  }

  private emit(): void {
    this.onChange?.(this._page, this._pages);
  }
}
