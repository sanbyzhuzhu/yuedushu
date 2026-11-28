import { afterEach, expect, it, vi } from 'vitest';
import { sourceHeaders, sourceSearchRequest } from '../src/engine/sourceRules';
import { encodeSourceQuery, legacySearchRequest } from '../src/engine/legacySource';
import { decodeSourceResponse } from '../src/engine/sourceResponse';
import { requestBytes, sourceHasSearchPages } from '../src/engine/networkLibrary';

afterEach(() => vi.unstubAllGlobals());
it('GBK 搜索编码及旧版 POST 模板保留原始请求语义', () => {
  expect(encodeSourceQuery('西游记', 'gbk')).toBe('%CE%F7%D3%CE%BC%C7');
  const r = legacySearchRequest('/search.php@q=searchKey&page=searchPage-1|char=gbk', 'http://books.test/', '西游记', 2);
  expect(r).toMatchObject({ url: 'http://books.test/search.php', method: 'POST', body: 'q=%CE%F7%D3%CE%BC%C7&page=1', charset: 'gbk' });
  expect(legacySearchRequest('/?q=searchKey&page=searchPage', 'http://books.test/', 'searchPage', 3).url).toBe('http://books.test/?q=searchPage&page=3');
  expect(() => encodeSourceQuery('😀', 'gbk')).toThrow('无法编码');
});
it('现代请求支持 JSON5、静态地址、编码占位符和页码算式', () => {
  const r = sourceSearchRequest("{{source.getKey()}}/search,{method:'POST',charset:'gbk',body:'q={{key}}&p={{page}}',headers:{Referer:'{{baseUrl}}'}}", 'https://books.test/', '西游记', 1);
  expect(r.body).toBe('q=%CE%F7%D3%CE%BC%C7&p=1'); expect(r.headers.Referer).toBe('https://books.test/');
  expect(sourceSearchRequest('/?q={{java.encodeURI(key,"gbk")}}&p={{page-1}}', 'https://books.test/', '西游记', 2).url).toBe('https://books.test/?q=%CE%F7%D3%CE%BC%C7&p=1');
  expect(sourceHasSearchPages({ searchUrl: '/?q=searchKey&p=searchPage-1' } as any)).toBe(true);
});
it('JSON body 转义关键词且不把关键词里的占位符再次替换', () => {
  const r = sourceSearchRequest('/api,{method:"POST",body:{q:"{{key}}",page:"{{page}}"}}', 'https://books.test/', '"{{page}}"', 2);
  expect(JSON.parse(r.body!)).toEqual({ q: '"{{page}}"', page: '2' });
  expect(r.headers['Content-Type']).toContain('application/json');
});
it('拒绝认证请求头、会话字段及脚本模板，不执行任何用户代码', () => {
  for (const key of ['Cookie', 'Authorization', 'X-Auth-Token', 'X-Api-Key', 'Proxy-Authorization']) expect(() => sourceHeaders({ [key]: 'secret' })).toThrow();
  expect(() => sourceSearchRequest('/api,{method:"POST",body:"password=secret"}', 'https://books.test/', '书', 1)).toThrow('认证');
  expect(() => sourceSearchRequest('/?q={{java.ajax("https://evil.test")}}', 'https://books.test/', '书', 1)).toThrow('脚本');
});
it('响应按 GBK 声明解码，BOM 优先于错误的服务端声明', () => {
  expect(decodeSourceResponse(new Uint8Array([0xce, 0xf7, 0xd3, 0xce, 0xbc, 0xc7]), 'text/html; charset=gb2312')).toBe('西游记');
  expect(decodeSourceResponse(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('西游记')]), 'text/html; charset=gbk')).toBe('西游记');
});
it('POST 303 转 GET，307 跨站不发送表单，跨站跳转不转发自定义头', async () => {
  vi.stubGlobal('window', {});
  const calls: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push({ url, ...init }); return calls.length === 1 ? new Response(null, { status: 303, headers: { location: '/done' } }) : new Response('ok'); }));
  await requestBytes('https://books.test/search', { method: 'POST', body: 'q=test', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, anonymous: true });
  expect(calls[1]).toMatchObject({ method: 'GET', credentials: 'omit' }); expect(calls[1].body).toBeUndefined(); expect(calls[1].headers['Content-Type']).toBeUndefined();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push({ url, ...init }); return new Response(null, { status: 307, headers: { location: 'https://elsewhere.test/' } }); }));
  await expect(requestBytes('https://books.test/search', { method: 'POST', body: 'q=test' })).rejects.toThrow('其他网站'); expect(calls).toHaveLength(1);
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push({ url, ...init }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } }) : new Response('ok'); }));
  await requestBytes('https://books.test/', { headers: { Referer: 'https://books.test/' } }); expect(calls[1].headers).toEqual({});
});
