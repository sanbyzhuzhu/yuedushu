/** 简繁转换引擎（V0.0.9）：OpenCC 词组级转换，渲染层应用、原文永不修改 */
import type { ConvMode } from './types';

type Conv = (s: string) => string;

let modP: Promise<typeof import('opencc-js')> | null = null;
const convs = new Map<string, Conv>();

export function hasConverter(mode: Exclude<ConvMode, 'off'>): boolean {
  return convs.has(mode);
}

const LANG: Record<Exclude<ConvMode, 'off'>, [string, string]> = {
  s2t: ['cn', 't'],
  t2s: ['t', 'cn'],
  s2tw: ['cn', 'tw'],
  tw2s: ['tw', 'cn'],
};

/** 预加载某个档位的转换器（含词典，首次较慢，之后同步可用） */
export async function ensureConverter(mode: Exclude<ConvMode, 'off'>): Promise<void> {
  if (convs.has(mode)) return;
  if (!modP) modP = import('opencc-js');
  const OpenCC = await modP;
  const [from, to] = LANG[mode];
  convs.set(mode, OpenCC.Converter({ from, to }) as Conv);
}

/** 同步转换（需先 ensureConverter） */
export function convertSync(text: string, mode: Exclude<ConvMode, 'off'>): string {
  if (!text) return text;
  return convs.get(mode)?.(text) ?? text;
}

const htmlCache = new Map<string, string>(); // `${mode}\u0000${html}` → 转换结果，LRU 30

/** 章节 HTML 转换：仅改文本节点，结构/划线标记原样保留 */
export async function convertHtml(html: string, mode: Exclude<ConvMode, 'off'>): Promise<string> {
  const key = `${mode}\u0000${html}`;
  const hit = htmlCache.get(key);
  if (hit) return hit;
  await ensureConverter(mode);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  for (const t of nodes) t.nodeValue = convertSync(t.nodeValue || '', mode);
  const out = doc.body.innerHTML;
  if (htmlCache.size >= 30) htmlCache.delete(htmlCache.keys().next().value as string);
  htmlCache.set(key, out);
  return out;
}

/** 互逆档位（用于批注引语跨档位重挂） */
export function inverseMode(m: Exclude<ConvMode, 'off'>): Exclude<ConvMode, 'off'> {
  return m === 's2t' ? 't2s' : m === 't2s' ? 's2t' : m === 's2tw' ? 'tw2s' : 's2tw';
}

export interface QuoteLike {
  exact: string;
  prefix: string;
  suffix: string;
}

export function convertQuote(q: QuoteLike, m: Exclude<ConvMode, 'off'>): QuoteLike {
  return {
    exact: convertSync(q.exact, m),
    prefix: convertSync(q.prefix, m),
    suffix: convertSync(q.suffix, m),
  };
}
