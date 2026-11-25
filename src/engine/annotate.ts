/**
 * 划线锚定引擎（V0.0.8）
 *
 * 采用"文本引语锚定"（W3C Web Annotation 思路的稳健锚）：
 *   定位 = { prefix, exact, suffix }，三方文本全部去除空白后匹配。
 * 去空白匹配的好处：跨块级元素（<p> 边界）、行内元素切分（<em>/<strong>）、
 * 空白折叠，全部不影响锚定 —— 对 TXT/MD/EPUB/DOCX 统一适用。
 * 重排版（字号/行距/横竖排变化）后重新渲染 DOM，再按引语重挂 <mark>。
 */

export interface Quote {
  exact: string;
  prefix: string;
  suffix: string;
}

interface Seg {
  node: Text;
  str: string; // 去空白后的文本
  map: number[]; // 去空白 idx → 原始 idx
  start: number; // 在全章去空白文本中的起点
}

function stripWs(s: string): string {
  return s.replace(/\s+/g, '');
}

export function quoteFromRange(range: Range, root?: HTMLElement): Quote | null {
  const exact = stripWs(range.toString());
  if (!exact.length) return null;
  const sc = range.startContainer;
  const ec = range.endContainer;
  let before =
    sc.nodeType === Node.TEXT_NODE ? (sc.nodeValue || '').slice(0, range.startOffset) : '';
  let after =
    ec.nodeType === Node.TEXT_NODE ? (ec.nodeValue || '').slice(range.endOffset) : '';
  // 跨节点采集上下文，已有划线和重复句子也能正确定位。
  if (root && root.contains(sc) && root.contains(ec)) {
    const context = document.createRange();
    context.selectNodeContents(root);
    context.setEnd(sc, range.startOffset);
    before = context.toString();
    context.selectNodeContents(root);
    context.setStart(ec, range.endOffset);
    after = context.toString();
  }
  return {
    exact,
    prefix: stripWs(before).slice(-24),
    suffix: stripWs(after).slice(0, 24),
  };
}

function buildSegs(root: HTMLElement): { segs: Seg[]; hay: string } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segs: Seg[] = [];
  let hay = '';
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const raw = n.nodeValue || '';
    if (!raw.trim()) continue;
    let str = '';
    const map: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (!/\s/.test(raw[i])) {
        str += raw[i];
        map.push(i);
      }
    }
    if (!str) continue;
    segs.push({ node: n as Text, str, map, start: hay.length });
    hay += str;
  }
  return { segs, hay };
}

function findMatch(hay: string, q: Quote): { start: number } | null {
  const pl = Math.min(q.prefix.length, 24);
  const sl = Math.min(q.suffix.length, 24);
  let best: { start: number; score: number } | null = null;
  let i = hay.indexOf(q.exact);
  while (i >= 0) {
    let score = 0;
    if (pl > 0 && hay.slice(Math.max(0, i - pl), i) === q.prefix.slice(-pl)) score += 1;
    if (sl > 0 && hay.slice(i + q.exact.length, i + q.exact.length + sl) === q.suffix.slice(0, sl))
      score += 1;
    if (!best || score > best.score) best = { start: i, score };
    i = hay.indexOf(q.exact, i + 1);
  }
  // 无前 后文命中时也接受纯引语命中（score 0），但完全找不到才返回 null
  return best ? { start: best.start } : null;
}

export interface MarkAttrs {
  id: string;
  color: string;
  hasNote: boolean;
}

/** 取得引文的正文位置，供搜索结果跳转使用，不修改正文。 */
export function rangeForQuote(root: HTMLElement, q: Quote): Range | null {
  const { segs, hay } = buildSegs(root);
  if (!q.exact) return null;
  const match = findMatch(hay, q);
  if (!match) return null;
  const end = match.start + q.exact.length;
  const first = segs.find((s) => s.start + s.str.length > match.start);
  const last = segs.find((s) => s.start < end && s.start + s.str.length >= end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, first.map[match.start - first.start]);
  range.setEnd(last.node, last.map[end - last.start - 1] + 1);
  return range;
}

/** 在章节 DOM 中定位引语并包裹 <mark>；返回是否锚定成功 */
export function applyQuote(root: HTMLElement, q: Quote, attrs: MarkAttrs): boolean {
  if (!q.exact.length) return false;
  const { segs, hay } = buildSegs(root);
  const m = findMatch(hay, q);
  if (!m) return false;
  const end = m.start + q.exact.length;

  let wrapped = false;
  for (const seg of segs) {
    const segEnd = seg.start + seg.str.length;
    if (segEnd <= m.start || seg.start >= end) continue;
    const s0 = Math.max(m.start - seg.start, 0);
    const e0 = Math.min(end - seg.start, seg.str.length);
    if (e0 <= s0) continue;
    const rawS = s0 === 0 ? 0 : seg.map[s0];
    const rawE = e0 >= seg.str.length ? (seg.node.nodeValue || '').length : seg.map[e0];
    if (rawE <= rawS) continue;

    // 拆分顺序必须先右后左：splitText 返回的是"后半段"。
    // 旧实现先按结束位拆分并把 target 指向了后半段，导致 mark 包住的是
    // [结束位, 段尾]（划线总是划到段落末尾）——与选中范围完全不符。
    const node: Text = seg.node;
    if (rawE < node.length) node.splitText(rawE); // node 保留为 [0, rawE)
    const target: Text = rawS > 0 ? node.splitText(rawS) : node; // target = [rawS, rawE)

    const mark = document.createElement('mark');
    mark.className = `hl c-${attrs.color}${attrs.hasNote ? ' has-note' : ''}`;
    mark.dataset.aid = attrs.id;
    if (target.parentNode) {
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      wrapped = true;
    }
  }
  return wrapped;
}
