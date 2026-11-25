/** 古树视图（V0.0.7）：水墨古树，枝 = 分类，叶果 = 书，果实成熟度 = 阅读进度 */
import { useMemo, useState } from 'react';
import { BookPages, useBookPage } from './BookPages';
import type { ReactNode } from 'react';
import type { BookMeta, CatNode } from '../engine/types';

const COLORS = { young: '#5B6B3A', half: '#BA7517', ripe: '#B03A2E' } as const;
const W = 680;
const H = 460;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function jitter(id: string, n: number): number {
  return ((hash(id + String(n)) % 100) / 100 - 0.5) * 2;
}

function maturity(pct: number | undefined): keyof typeof COLORS {
  const p = pct ?? 0;
  return p >= 1 ? 'ripe' : p > 0.02 ? 'half' : 'young';
}

interface Props {
  books: BookMeta[];
  nodes: CatNode[];
  pct: Record<string, number>;
  onOpen: (id: string) => void;
}

export function TreeView({ books, nodes, pct, onOpen }: Props) {
  const [indexOpen, setIndexOpen] = useState(false);
  const bookPage = useBookPage(books, books[0]?.id ?? 'empty');
  const tree = useMemo(() => {
    const byNode = new Map<string | null, BookMeta[]>();
    for (const b of books) { const list = byNode.get(b.nodeId) ?? []; list.push(b); byNode.set(b.nodeId, list); }
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const rootCounts = new Map<string, number>();
    for (const n of nodes) { let cur = n; const seen = new Set<string>(); while (cur.parentId && !seen.has(cur.id)) { seen.add(cur.id); const parent = nodeMap.get(cur.parentId); if (!parent) break; cur = parent; } rootCounts.set(cur.id, (rootCounts.get(cur.id) ?? 0) + (byNode.get(n.id)?.length ?? 0)); }
    const branches: ReactNode[] = [];
    const labels: ReactNode[] = [];
    const fruits: ReactNode[] = [];

    const booksOf = (nodeId: string | null) => byNode.get(nodeId) ?? [];

    const fruit = (key: string, x: number, y: number, b: BookMeta, rot: number) => {
      if (fruits.length >= 208) return;
      const fill = COLORS[maturity(pct[b.id])];
      fruits.push(
        <g key={key} className="fruit" role="button" tabIndex={0} aria-label={`阅读《${b.title}》`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(b.id); } }} onClick={() => onOpen(b.id)}>
          <title>{`${b.title}（${maturity(pct[b.id]) === 'ripe' ? '已读完' : maturity(pct[b.id]) === 'half' ? '在读' : '未读'}）`}</title>
          <rect
            x={x - 7}
            y={y - 13}
            width={14}
            height={26}
            rx={3}
            fill={fill}
            stroke="rgba(42,39,35,0.28)"
            strokeWidth={0.6}
            transform={rot ? `rotate(${rot} ${x} ${y})` : undefined}
          />
          <rect x={x - 2} y={y - 13} width={4} height={26} fill="rgba(247,242,231,0.55)" transform={rot ? `rotate(${rot} ${x} ${y})` : undefined} />
        </g>,
      );
    };

    const booksAlong = (
      sx: number,
      sy: number,
      ex: number,
      ey: number,
      angle: number,
      list: BookMeta[],
      keyPrefix: string,
    ) => {
      const n = list.length;
      if (n === 0) return;
      const shown = Math.min(n, 26);
      for (let i = 0; i < shown; i++) {
        const t = 0.3 + (0.62 * (i + 0.5)) / shown;
        const jx = jitter(list[i].id, 1) * 10;
        const jy = jitter(list[i].id, 2) * 8;
        fruit(
          `${keyPrefix}-${list[i].id}`,
          sx + (ex - sx) * t + jx,
          sy + (ey - sy) * t + jy,
          list[i],
          angle * 0.5,
        );
      }
      if (n > shown) {
        labels.push(
          <text key={`${keyPrefix}-more`} x={(sx + ex) / 2} y={(sy + ey) / 2 - 14} fontSize={11} fill="#7a6f5d" textAnchor="middle">
            ＋{n - shown}
          </text>,
        );
      }
    };

    const trunkTop = { x: 340, y: 280 };

    // 一级分类
    const cats = nodes.filter((n) => !n.parentId);
    const k = cats.length;
    cats.forEach((cat, i) => {
      const angle = k === 1 ? 0 : -72 + (144 * i) / (k - 1);
      const rad = (angle * Math.PI) / 180;
      const count = rootCounts.get(cat.id) ?? 0;
      const len = 95 + Math.min(55, count * 4);
      const ex = trunkTop.x + Math.sin(rad) * len;
      const ey = trunkTop.y - Math.cos(rad) * len;
      const cx = trunkTop.x + Math.sin(rad) * len * 0.5 + jitter(cat.id, 3) * 18;
      const cy = trunkTop.y - Math.cos(rad) * len * 0.5 - 18;

      branches.push(
        <path
          key={`br-${cat.id}`}
          d={`M ${trunkTop.x} ${trunkTop.y} Q ${cx} ${cy} ${ex} ${ey}`}
          stroke="#6b4a2f"
          strokeWidth={4.5}
          fill="none"
          strokeLinecap="round"
        />,
      );
      labels.push(
        <text key={`lb-${cat.id}`} x={ex + Math.sin(rad) * 16} y={ey - Math.cos(rad) * 16 + 4} fontSize={12} fill="#7a6f5d" textAnchor="middle">
          {cat.name}
        </text>,
      );

      // 二级分类
      const subs = nodes.filter((n) => n.parentId === cat.id);
      subs.forEach((sub, j) => {
        const sa = angle + (subs.length === 1 ? jitter(sub.id, 4) * 14 : -20 + (40 * j) / Math.max(1, subs.length - 1));
        const srad = (sa * Math.PI) / 180;
        const slen = 52;
        const sex = ex + Math.sin(srad) * slen;
        const sey = ey - Math.cos(srad) * slen;
        branches.push(
          <path
            key={`br-${sub.id}`}
            d={`M ${ex} ${ey} Q ${(ex + sex) / 2} ${(ey + sey) / 2 - 10} ${sex} ${sey}`}
            stroke="#6b4a2f"
            strokeWidth={2.8}
            fill="none"
            strokeLinecap="round"
          />,
        );
        booksAlong(ex, ey, sex, sey, sa, booksOf(sub.id), `s-${sub.id}`);
      });

      booksAlong(trunkTop.x, trunkTop.y, ex, ey, angle, booksOf(cat.id), `c-${cat.id}`);
    });

    // 未分类：落叶归根，铺在地面
    const loose = booksOf(null).slice(0, 52);
    if (loose.length) {
      const step = Math.min(36, (W - 120) / Math.max(1, loose.length - 1));
      const startX = 340 - ((loose.length - 1) * step) / 2;
      loose.forEach((b, i) => {
        fruit(`g-${b.id}`, startX + i * step + jitter(b.id, 5) * 4, 424, b, 0);
      });
    }

    return { branches, labels, fruits, loose };
  }, [books, nodes, pct, onOpen]);

  return (
    <div className="tree-wrap">
      <svg className="tree-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="藏书树，选择书卷开始阅读">
        <title>古树书架</title>
        <desc>枝为分类，果为书，成熟度代表阅读进度</desc>
        {/* 图例 */}
        <g fontSize={11} fill="#7a6f5d">
          <rect x={W - 176} y={18} width={10} height={18} rx={2} fill={COLORS.young} />
          <text x={W - 162} y={31}>未读</text>
          <rect x={W - 120} y={18} width={10} height={18} rx={2} fill={COLORS.half} />
          <text x={W - 106} y={31}>在读</text>
          <rect x={W - 64} y={18} width={10} height={18} rx={2} fill={COLORS.ripe} />
          <text x={W - 50} y={31}>读完</text>
        </g>
        {/* 树干 */}
        <path
          d="M 340 424 C 333 384 347 336 340 280"
          stroke="#6b4a2f"
          strokeWidth={15}
          fill="none"
          strokeLinecap="round"
        />
        <path d="M 340 424 C 330 430 322 434 312 436 M 340 424 C 350 430 358 434 368 436" stroke="#6b4a2f" strokeWidth={6} fill="none" strokeLinecap="round" />
        {tree.branches}
        {tree.labels}
        {tree.fruits}
        {/* 地面 */}
        <line x1={40} y1={444} x2={W - 40} y2={444} stroke="rgba(42,39,35,0.25)" strokeWidth={1} strokeDasharray="3 5" />
      </svg>
      <p className="tree-legend"><span>青 · 未读</span><span>赭 · 在读</span><span>朱 · 读完</span></p>
      {books.length > tree.fruits.length ? <p className="set-hint">树图展示部分藏书，可在下方索引查阅全部 {books.length} 本。</p> : null}
      <details className="panel-details tree-index" onToggle={(e) => setIndexOpen(e.currentTarget.open)}><summary>藏书索引<span>{books.length} 本</span></summary>
        <div>{indexOpen ? <><BookPages {...bookPage} />{bookPage.items.map((b) => <button key={b.id} onClick={() => onOpen(b.id)}>{b.title}</button>)}</> : null}</div>
      </details>
    </div>
  );
}
