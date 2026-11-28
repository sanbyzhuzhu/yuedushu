import JSON5 from 'json5';
import { JSONPath } from 'jsonpath-plus';
import { secureUrl } from './networkLibrary';
import { legacyElements, legacyExtract, legacySearchRequest, replaceSourceText, validateLegacyRule, validateReplacement } from './legacySource';
import { assertAnonymousRequest } from './sourcePolicy';
import type { BookSource } from './networkLibrary';

export type SourceData = Document | Element | Record<string, unknown> | unknown[];
function split(rule: string) {
  if (typeof rule !== 'string' || /<js|@js|javascript:|@put:|@get:|@webview|java\./i.test(rule)) throw new Error('规则需要脚本、变量存取或网页交互，本批暂不支持');
  const [selection, pattern, replacement = ''] = rule.split('##');
  if (pattern) validateReplacement(pattern);
  return { selection: selection.trim(), pattern, replacement };
}
/** Split combinations without splitting CSS attributes, XPath arguments or JSON keys. */
function combination(text: string, operator: string): string[] {
  const parts: string[] = []; let start = 0, depth = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') { i++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[' || char === '(') depth++;
    else if (char === ']' || char === ')') depth--;
    if (depth === 0 && text.startsWith(operator, i)) { parts.push(text.slice(start, i).trim()); start = i + operator.length; i += operator.length - 1; }
  }
  parts.push(text.slice(start).trim());
  const nonempty = parts.filter(Boolean);
  if (!nonempty.length) throw new Error('组合提取规则为空');
  return nonempty;
}
function cssRule(rule: string) { return rule.replace(/^@css:/i, ''); }
function isDom(data: SourceData): data is Document | Element { return typeof Node !== 'undefined' && data instanceof Node; }
function isJsonPath(rule: string) { return /^(?:\$|@json:)/i.test(rule); }
function isXPath(rule: string) { return /^(?:\.?\/\/|\/html\b|@xpath:|(?:string|normalize-space|concat)\()/i.test(rule); }
function validatePath(rule: string) {
  if (/\?\(|\[\s*\(|`|(?:^|[.\["'])(?:__proto__|prototype|constructor)(?:$|[.\]"'])/.test(rule)) throw new Error('JSONPath 仅支持数据选择，不支持脚本过滤或原型访问');
  try { JSONPath({ path: rule.replace(/^@json:/i, ''), json: {}, eval: false }); } catch { throw new Error('JSONPath 规则无效'); }
}
function pathValues(data: unknown, rule: string): unknown[] {
  const value = rule.replace(/^@json:/i, ''), path = value.startsWith('$') ? value : '$.' + value;
  validatePath(path);
  return JSONPath({ path, json: data as object, eval: false }) as unknown[];
}
function xpathValues(data: Document | Element, rule: string): (Node | string)[] {
  const doc = data.nodeType === 9 ? data as Document : data.ownerDocument!;
  const value = doc.evaluate(rule.replace(/^@xpath:/i, ''), data, null, XPathResult.ANY_TYPE, null);
  if (value.resultType === XPathResult.STRING_TYPE) return [value.stringValue];
  if (value.resultType === XPathResult.NUMBER_TYPE) return [String(value.numberValue)];
  if (value.resultType === XPathResult.BOOLEAN_TYPE) return [String(value.booleanValue)];
  const result: Node[] = []; for (let node = value.iterateNext(); node; node = value.iterateNext()) result.push(node);
  return result;
}
function validateSelection(selection: string) {
  for (const fallback of combination(selection, '||')) for (const part of combination(fallback, '&&')) {
    if (part.includes('{{')) {
      const rest = part.replace(/\{\{\s*(\$[^{}]+?)\s*\}\}/g, (_, path) => { validatePath(path); return ''; });
      if (rest.includes('{{')) throw new Error('规则模板包含尚不支持的脚本');
    } else if (isJsonPath(part)) validatePath(part);
    else if (isXPath(part)) {
      if (typeof document.evaluate === 'function') { try { document.evaluate(part.replace(/^@xpath:/i, ''), document, null, XPathResult.ANY_TYPE, null); } catch { throw new Error('XPath 规则无效'); } }
    } else validateLegacyRule(cssRule(part));
  }
}
export function validateSourceRule(rule: string) { validateSelection(split(rule).selection); }
function selectItems(data: SourceData, part: string): SourceData[] {
  if (!isDom(data)) return pathValues(data, part).flatMap(v => Array.isArray(v) ? v : [v]).filter(v => v && typeof v === 'object') as SourceData[];
  if (isXPath(part)) return xpathValues(data, part).filter(v => v instanceof Element) as Element[];
  return legacyElements(data, cssRule(part));
}
export function sourceRuleItems(data: SourceData, rule: string): SourceData[] {
  const { selection } = split(rule);
  for (const fallback of combination(selection, '||')) { const items = combination(fallback, '&&').flatMap(part => selectItems(data, part)); if (items.length) return [...new Set(items)]; }
  return [];
}
async function extractValue(data: SourceData, part: string, signal: AbortSignal) {
  if (part.includes('{{')) return part.replace(/\{\{\s*(\$[^{}]+?)\s*\}\}/g, (_, path) => String(pathValues(data, path)[0] ?? ''));
  if (!isDom(data)) return pathValues(data, part).map(v => v == null ? '' : String(v)).join('\n');
  if (isXPath(part)) return xpathValues(data, part).map(v => typeof v === 'string' ? v : v.textContent || '').join('\n');
  return legacyExtract(data, cssRule(part), signal);
}
export async function sourceRuleValue(data: SourceData, rule: string | undefined, signal: AbortSignal): Promise<string> {
  if (!rule) return ''; signal.throwIfAborted(); const { selection, pattern, replacement } = split(rule); let result = '';
  for (const fallback of combination(selection, '||')) {
    const values: string[] = [];
    for (const part of combination(fallback, '&&')) values.push(await extractValue(data, part, signal));
    result = values.filter(Boolean).join('\n'); if (result) break;
  }
  return result && pattern ? replaceSourceText(result, pattern, replacement, signal) : result;
}
export function sourceRuleIsHtml(rule: string) { return /@(?:html|all)(?:##|$)/i.test(rule); }
const headerCache = new Map<string, Record<string, string>>();
export function sourceHeaders(value: unknown, base?: string): Record<string, string> {
  if (!value) return {};
  const cacheKey = typeof value === 'string' ? value + '\n' + (base || '') : undefined;
  if (cacheKey && headerCache.has(cacheKey)) return headerCache.get(cacheKey)!;
  let data: unknown;
  try { data = typeof value === 'string' ? JSON5.parse(value) : value; } catch { throw new Error('请求头必须为普通 JSON 对象，不能包含脚本'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('书源请求头应为 JSON 对象');
  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(data)) {
    if (!/^[\w-]+$/.test(key) || typeof item !== 'string' || /[\r\n]/.test(item)) throw new Error('书源请求头格式无效');
    if (/(?:^|[-_])(?:cookie|authorization|token|session|auth|sign|signature|api-key|apikey)(?:$|[-_])/i.test(key) || /^x-api-key$/i.test(key)) throw new Error('请求头包含登录或认证信息，不予导入');
    if (/^(host|content-length|connection|proxy-authorization|set-cookie)$/i.test(key)) throw new Error('不支持的请求头：' + key);
    if (/^accept-encoding$/i.test(key)) continue;
    let resolved = item;
    if (base) resolved = resolved.replace(/\{\{\s*(?:baseUrl|source\.getKey\(\))\s*\}\}/g, base);
    if (/\{\{|<js|@js/i.test(resolved)) throw new Error('请求头包含尚不支持的动态规则');
    assertAnonymousRequest(resolved);
    const existing = Object.keys(headers).find(k => k.toLowerCase() === key.toLowerCase());
    if (existing) delete headers[existing]; headers[key] = resolved;
  }
  if (cacheKey) { if (headerCache.size >= 256) headerCache.clear(); headerCache.set(cacheKey, headers); }
  return headers;
}
export function sourceSearchRequest(template: string, base: string, key: string, page: number, defaults?: Record<string, string>) {
  if (typeof template !== 'string' || !template.trim()) throw new Error('缺少搜索地址');
  assertAnonymousRequest(template);
  const match = /,\s*(\{[\s\S]*\})\s*$/.exec(template);
  let urlTemplate = match ? template.slice(0, match.index) : template;
  let options: Record<string, any> = {};
  if (match) { try { options = JSON5.parse(match[1]); } catch { throw new Error('搜索请求配置不是普通 JSON'); } }
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('搜索请求配置无效');
  for (const name of Object.keys(options)) {
    if (name === 'webView' && (options[name] === false || options[name] === 'false')) continue;
    if (!['method', 'body', 'charset', 'headers', 'header'].includes(name)) throw new Error('暂不支持搜索请求选项：' + name);
  }
  const method = String(options.method || 'GET').toUpperCase(); if (!['GET', 'POST'].includes(method)) throw new Error('仅支持 GET / POST 搜索');
  const headers = sourceHeaders(defaults, base);
  const mergedHeaders = { ...headers };
  for (const [key, value] of Object.entries(sourceHeaders(options.headers || options.header, base))) { const old = Object.keys(mergedHeaders).find(k => k.toLowerCase() === key.toLowerCase()); if (old) delete mergedHeaders[old]; mergedHeaders[key] = value; }
  const contentType = Object.entries(mergedHeaders).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '';
  const declaredCharset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  let charset = String(options.charset || declaredCharset || 'utf-8').toLowerCase();
  let usesKeyword = false;
  const normalize = (text: string) => {
    text = text.replace(/\{\{\s*(?:source\.getKey\(\)|baseUrl)\s*\}\}/g, base.replace(/\/$/, ''));
    text = text.replace(/\{\{\s*(?:java\.)?encodeURI(?:Component)?\(\s*key\s*(?:,\s*['"]([^'"]+)['"]\s*)?\)\s*\}\}/g, (_, encoding: string) => { if (encoding) { if (options.charset && charset !== encoding.toLowerCase()) throw new Error('搜索编码配置冲突'); charset = encoding.toLowerCase(); } return '{{key}}'; });
    text = text.replace(/\{\{\s*page\s*([+-])\s*(\d+)\s*\}\}/g, 'searchPage$1$2');
    if (/<js|@js|\{\{(?!\s*(?:key|page)\s*\}\})|\$\{/i.test(text)) throw new Error('搜索地址包含尚不支持的脚本');
    if (/searchKey|\{\{\s*key\s*\}\}/.test(text)) usesKeyword = true;
    return text.replace(/\{\{\s*key\s*\}\}/g, 'searchKey').replace(/\{\{\s*page\s*\}\}/g, 'searchPage');
  };
  urlTemplate = normalize(urlTemplate);
  let body = options.body;
  if (body !== undefined && typeof body !== 'string' && (typeof body !== 'object' || body === null)) throw new Error('搜索 body 需要字符串或 JSON 对象');
  const jsonBody = body && (typeof body === 'object' || /json/i.test(contentType));
  if (jsonBody) {
    if (!/^utf-?8$/i.test(charset)) throw new Error('JSON 搜索 body 目前仅支持 UTF-8');
    const jsonText = typeof body === 'string' ? body : JSON.stringify(body);
    if (/\{\{\s*key\s*\}\}/.test(jsonText)) usesKeyword = true;
    if (/\{\{(?!\s*(?:key|page)\s*\}\})|<js|@js/i.test(jsonText)) throw new Error('JSON 搜索 body 包含尚不支持的脚本');
    const interpolated = jsonText.replace(/\{\{\s*(key|page)\s*\}\}/g, (_, token) => token === 'key' ? JSON.stringify(key).slice(1, -1) : String(page));
    try { body = JSON.stringify(JSON5.parse(interpolated)); } catch { throw new Error('JSON 搜索 body 格式无效'); }
    if (!contentType) mergedHeaders['Content-Type'] = 'application/json; charset=utf-8';
  } else if (typeof body === 'string') body = normalize(body);
  if (!usesKeyword) throw new Error('搜索地址未使用关键词，本批不导入仅发现或固定书单入口');
  const request = legacySearchRequest(urlTemplate + (method === 'POST' && !jsonBody ? '@' + (body || '') : '') + (charset !== 'utf-8' ? '|char=' + charset : ''), base, key, page);
  if (method === 'GET' && options.body) throw new Error('GET 搜索不能附带 body');
  return { ...request, method, body: method === 'POST' ? jsonBody ? body as string : request.body || '' : undefined, headers: mergedHeaders };
}
export function validateDeclarativeSource(source: BookSource, validated = new Set<string>()) {
  const check = (rule: string) => { if (!validated.has(rule)) { validateSourceRule(rule); validated.add(rule); } };
  secureUrl(source.bookSourceUrl); sourceSearchRequest(source.searchUrl, source.bookSourceUrl, 'test', 1, source.requestHeaders); sourceHeaders(source.requestHeaders);
  for (const [section, keys] of [[source.ruleSearch, ['bookList', 'name', 'bookUrl']], [source.ruleToc, ['chapterList', 'chapterName', 'chapterUrl']], [source.ruleContent, ['content']]] as const) for (const name of keys) { if (!section || typeof section[name] !== 'string' || !section[name]) throw new Error('缺少 ' + name + ' 规则'); check(section[name]); }
  for (const value of [source.ruleSearch.author, source.ruleBookInfo?.tocUrl, source.ruleToc.nextTocUrl, source.ruleContent.nextContentUrl, source.ruleBookInfo?.init]) if (value) check(value);
  if (source.ruleContent.replaceRegex) split(source.ruleContent.replaceRegex.startsWith('##') ? 'text' + source.ruleContent.replaceRegex : 'text##' + source.ruleContent.replaceRegex);
  if (source.ruleToc.isReverse && !['true', 'false'].includes(String(source.ruleToc.isReverse))) throw new Error('目录逆序需要脚本，本批暂不支持');
  if (source.ruleContent.webJs || source.ruleContent.sourceRegex || source.ruleToc.isVolume && String(source.ruleToc.isVolume) !== 'false') throw new Error('书源需要网页交互、特殊正文解码或分卷规则，本批暂不支持');
}
