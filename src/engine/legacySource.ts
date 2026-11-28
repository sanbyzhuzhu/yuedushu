import { secureUrl } from './networkLibrary';
import type { BookSource } from './networkLibrary';
import { assertAnonymousRequest } from './sourcePolicy';

const OUTPUTS = /^(?:textNodes|text|html|all|href|src|title|content|value|alt|data-[\w-]+)$/;
interface Step { selector: string; indexes?: number[]; excluded: number[]; text?: string; ownText?: boolean; children?: boolean }
interface Alternative { steps: Step[]; output: string }
interface Rule { alternatives: Alternative[]; pattern?: string; replacement: string }
const ruleCache = new Map<string, Rule>();
function cssEscape(text: string) { return typeof CSS !== 'undefined' ? CSS.escape(text) : text.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c.codePointAt(0)!.toString(16) + ' '); }
function step(value: string): Step {
  let text = value.trim(), excluded: number[] = [], indexes: number[] | undefined;
  const exclude = /!(-?\d+(?::-?\d+)*)$/.exec(text);
  if (exclude) { excluded = exclude[1].split(':').map(Number); text = text.slice(0, exclude.index); }
  const position = /\.(-?\d+(?::-?\d+)*)\.?$/.exec(text);
  if (position) { indexes = position[1].split(':').map(Number); text = text.slice(0, position.index); }
  let contains: string | undefined, ownText = false;
  if (text.startsWith('class.')) text = text.slice(6).split(/\s+/).filter(Boolean).map(v => '.' + cssEscape(v)).join('');
  else if (text.startsWith('id.')) text = '#' + cssEscape(text.slice(3));
  else if (text.startsWith('tag.')) text = text.slice(4);
  else if (text.startsWith('text.')) { contains = text.slice(5); ownText = true; text = '*'; }
  else {
    const match = /:contains(Own)?\(([^()]*)\)$/.exec(text);
    if (match) { contains = match[2].replace(/^['"]|['"]$/g, ''); ownText = !!match[1]; text = text.slice(0, match.index) || '*'; }
  }
  const children = text === 'children';
  text = text.replace(/(\[\s*[\w:-]+\s*[~|^$*]?=\s*)([^\]"'\s][^\]\s]*)(\s*\])/g, (_, prefix, value, end) => prefix + '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' + end);
  if (!text) throw new Error('书源选择器为空');
  if (!children) { try { document.createElement('div').querySelector(text); } catch { throw new Error('不支持的选择器：' + value); } }
  return { selector: text, indexes, excluded, text: contains, ownText, children };
}
function parseRule(value: string): Rule {
  const cached = ruleCache.get(value); if (cached) return cached;
  if (typeof value !== 'string') throw new Error('旧版规则应为字符串');
  let selection = value, pattern: string | undefined, replacement = '';
  // A CSS #id is a selector. Legacy regex begins after an extraction attribute.
  const marker = /(?:^|@)(?:textNodes|text|html|all|href|src|title|content|value|alt|data-[\w-]+)#/.exec(value);
  if (marker) { const at = marker.index + marker[0].length - 1; selection = value.slice(0, at); [pattern, replacement = ''] = value.slice(at + 1).split('#'); }
  if (/<js|@js|javascript:|\{\{|^\$/i.test(selection) || /\^/.test(selection.replace(/\[[^\]]*\]/g, ''))) throw new Error('旧版规则包含尚不支持的脚本或特殊处理');
  if (pattern) validateReplacement(pattern);
  const alternatives = selection.split('|').filter(v => v.trim()).map(part => {
    const chain = part.trim().replace(/^@css:/i, '').split('@').filter(Boolean);
    const output = OUTPUTS.test(chain[chain.length - 1] || '') ? chain.pop()! : 'text';
    return { steps: chain.map(step), output };
  });
  if (!alternatives.length) throw new Error('书源规则为空');
  const parsed = { alternatives, pattern, replacement };
  if (ruleCache.size >= 5000) ruleCache.clear(); ruleCache.set(value, parsed);
  return parsed;
}
export function validateLegacyRule(value: string) { parseRule(value); }
export function legacyContentIsHtml(value: string) { return parseRule(value).alternatives.some(v => ['html', 'all'].includes(v.output)); }
function select(root: ParentNode, steps: Step[]): Element[] {
  let parents: ParentNode[] = [root];
  for (const part of steps) parents = parents.flatMap(parent => {
    let found = part.children ? Array.from(parent.children) : Array.from(parent.querySelectorAll(part.selector));
    if (parent instanceof Element && !part.children && parent.matches(part.selector)) found.unshift(parent);
    if (part.text !== undefined) found = found.filter(el => (part.ownText ? Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent || '').join('') : el.textContent || '').includes(part.text!));
    // Indexes and exclusions refer to the original selection, not a shrinking array.
    const size = found.length;
    if (part.indexes) found = part.indexes.map(i => i < 0 ? size + i : i).filter(i => i >= 0 && i < size && !part.excluded.some(n => (n < 0 ? size + n : n) === i)).map(i => found[i]);
    else if (part.excluded.length) found = found.filter((_, i) => !part.excluded.some(n => (n < 0 ? size + n : n) === i));
    return found;
  });
  return [...new Set(parents.filter((v): v is Element => v instanceof Element))];
}
export function legacyElements(root: ParentNode, value: string): Element[] {
  for (const part of parseRule(value).alternatives) { const found = part.steps.length ? select(root, part.steps) : root instanceof Element ? [root] : []; if (found.length) return found; }
  return [];
}
function ownText(el: Element) { return Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent?.trim()).filter(Boolean).join('\n'); }
interface PendingRegex { resolve: (text: string) => void; reject: (error: Error) => void; cleanup: () => void }
let regexWorker: Worker | undefined; let regexId = 0;
const pendingRegex = new Map<number, PendingRegex>();
function resetWorker(reason: string) {
  regexWorker?.terminate(); regexWorker = undefined;
  for (const request of pendingRegex.values()) { request.cleanup(); request.reject(new Error(reason)); } pendingRegex.clear();
}
export function validateReplacement(pattern: string) {
  if (pattern.length > 2048) throw new Error('书源替换正则超过 2048 字符，暂不支持');
  try { new RegExp(pattern, 'g'); } catch { throw new Error('书源替换正则无效'); }
}
export function replaceSourceText(value: string, pattern: string, replacement: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted(); validateReplacement(pattern);
  return new Promise((resolve, reject) => {
    if (!regexWorker) {
      regexWorker = new Worker(new URL('./sourceRegex.worker.ts', import.meta.url), { type: 'module' });
      regexWorker.onmessage = event => {
        const request = pendingRegex.get(event.data.id); if (!request) return;
        pendingRegex.delete(event.data.id); request.cleanup();
        event.data.error ? request.reject(new Error(event.data.error)) : request.resolve(event.data.value);
      };
      regexWorker.onerror = () => resetWorker('书源替换规则执行失败');
    }
    const id = ++regexId, abort = () => resetWorker('已取消');
    const timeout = setTimeout(() => resetWorker('书源替换规则执行超时，请检查该书源'), 2000);
    const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); };
    pendingRegex.set(id, { resolve, reject, cleanup }); signal.addEventListener('abort', abort, { once: true });
    regexWorker.postMessage({ id, value, pattern, replacement });
  });
}
export async function legacyExtract(root: ParentNode, value: string | undefined, signal: AbortSignal): Promise<string> {
  if (!value) return ''; signal.throwIfAborted(); const rule = parseRule(value); let result = '';
  for (const part of rule.alternatives) {
    const found = part.steps.length ? select(root, part.steps) : root instanceof Element ? [root] : [];
    result = found.map(el => ['html', 'all'].includes(part.output) ? el.innerHTML : part.output === 'textNodes' ? ownText(el) : part.output === 'text' ? el.textContent || '' : el.getAttribute(part.output) || '').join('\n').trim();
    if (result) break;
  }
  return result && rule.pattern ? replaceSourceText(result, rule.pattern, rule.replacement, signal) : result;
}
const gbkChars = new Map<string, string>();
export function encodeSourceQuery(value: string, charset = 'utf-8'): string {
  charset = charset.toLowerCase();
  if (charset === 'escape') return value.split('').map(c => c.charCodeAt(0) > 255 ? '%u' + c.charCodeAt(0).toString(16).padStart(4, '0') : encodeURIComponent(c)).join('');
  if (/^utf-?8$/.test(charset)) return encodeURIComponent(value);
  if (!['gbk', 'gb2312', 'gb18030'].includes(charset)) throw new Error('不支持搜索编码：' + charset);
  if (/^[\x00-\x7f]*$/.test(value)) return encodeURIComponent(value);
  if (!gbkChars.size) {
    const decoder = new TextDecoder('gb18030'), bytes = new Uint8Array(2);
    for (let first = 0x81; first <= 0xfe; first++) for (let second = 0x40; second <= 0xfe; second++) {
      if (second === 0x7f) continue; bytes[0] = first; bytes[1] = second; const char = decoder.decode(bytes);
      if (char.length === 1 && char !== '\ufffd' && !gbkChars.has(char)) gbkChars.set(char, '%' + first.toString(16).toUpperCase() + '%' + second.toString(16).toUpperCase());
    }
  }
  return Array.from(value).map(char => { if (char.charCodeAt(0) < 128) return encodeURIComponent(char); const encoded = gbkChars.get(char); if (!encoded) throw new Error('此 GBK 书源无法编码字符“' + char + '”，请使用其他关键词或 UTF-8 书源'); return encoded; }).join('');
}
export function legacySearchRequest(template: string, base: string, key: string, page: number) {
  if (typeof template !== 'string' || !template || template === '-' || template === 'searchKey') throw new Error('旧版书源没有有效搜索地址');
  if (/<js|@js|\{\{|\$\{/i.test(template)) throw new Error('搜索地址包含尚不支持的脚本');
  assertAnonymousRequest(template);
  if (!Number.isInteger(page) || page < 1) throw new Error('搜索页码无效');
  let charset = 'utf-8';
  template = template.replace(/\|char=([^&|]+)/i, (_, v: string) => { charset = v.toLowerCase(); return ''; });
  // Validate charset even when the template doesn't contain a query placeholder.
  encodeSourceQuery('', charset);
  const encoded = encodeSourceQuery(key, charset);
  template = template.replace(/[^\x00-\x7f]+/g, v => encodeSourceQuery(v, charset)).replace(/searchKey|searchPage(?:([+-])(\d+))?/g, (word, sign, offset) => word === 'searchKey' ? encoded : String(page + (sign ? (sign === '-' ? -1 : 1) * Number(offset) : 0)));
  const at = template.indexOf('@');
  return { url: secureUrl(at < 0 ? template : template.slice(0, at), base), method: at < 0 ? 'GET' : 'POST', body: at < 0 ? undefined : template.slice(at + 1), charset };
}
export function normalizeLegacySource(raw: Record<string, any>): BookSource {
  const source: BookSource = { bookSourceName: String(raw.bookSourceName || '未命名书源'), bookSourceUrl: raw.bookSourceUrl, searchUrl: raw.ruleSearchUrl, format: 'legacy', httpUserAgent: raw.httpUserAgent || undefined, ruleSearch: { bookList: raw.ruleSearchList, name: raw.ruleSearchName, author: raw.ruleSearchAuthor || '', bookUrl: raw.ruleSearchNoteUrl }, ruleBookInfo: { tocUrl: raw.ruleChapterUrl || '' }, ruleToc: { chapterList: raw.ruleChapterList, chapterName: raw.ruleChapterName, chapterUrl: raw.ruleContentUrl, nextTocUrl: raw.ruleChapterUrlNext || '' }, ruleContent: { content: raw.ruleBookContent, nextContentUrl: raw.ruleContentUrlNext || '' } };
  validateLegacySource(source); return source;
}
export function validateLegacySource(source: BookSource) {
  if (typeof source.searchUrl !== 'string' || !source.searchUrl.includes('searchKey')) throw new Error('旧版搜索地址未使用关键词，仅发现或固定书单入口');
  legacySearchRequest(source.searchUrl, source.bookSourceUrl, 'test', 1);
  if (source.httpUserAgent && /[\r\n]|\{\{|<js|@js/i.test(source.httpUserAgent)) throw new Error('书源 User-Agent 无效');
  for (const [section, keys] of [[source.ruleSearch, ['bookList', 'name', 'bookUrl']], [source.ruleToc, ['chapterList', 'chapterName', 'chapterUrl']], [source.ruleContent, ['content']]] as const) for (const key of keys) if (!section?.[key] || section[key] === '-') throw new Error('旧版书源缺少 ' + key + ' 规则');
  for (const section of [source.ruleSearch, source.ruleBookInfo || {}, source.ruleToc, source.ruleContent]) for (const value of Object.values(section)) if (value) validateLegacyRule(value);
}
