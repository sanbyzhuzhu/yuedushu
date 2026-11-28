import { expect, it } from 'vitest';
import { parseLibraryQr } from '../src/engine/libraryQr';
import { parseSources, requestBytes } from '../src/engine/networkLibrary';
import { vi, afterEach } from 'vitest';
import { parseHTML } from 'linkedom';

afterEach(() => vi.unstubAllGlobals());

it('Olib 分享根地址转换为 OPDS，保留 HTTP 和端口', () => {
  expect(parseLibraryQr('http://192.168.1.17:8765/')).toEqual({ url: 'http://192.168.1.17:8765/opds', kind: 'opds', name: '192.168.1.17' });
  expect(parseLibraryQr('http://192.168.1.17:8765/opds?page=2').url).toBe('http://192.168.1.17:8765/opds?page=2');
});
it('读取 OPDS 分享协议与结构化书库二维码', () => {
  expect(parseLibraryQr('opds://http://library.test/opds').url).toBe('http://library.test/opds');
  expect(parseLibraryQr('opds://library.test/opds').url).toBe('http://library.test/opds');
  expect(parseLibraryQr('{"url":"https://library.test/dav/","name":"我的藏书","type":"webdav"}')).toEqual({ url: 'https://library.test/dav/', name: '我的藏书', kind: 'webdav' });
});
it('二维码不能注入脚本、本地文件或内嵌凭据', () => {
  for (const text of ['javascript:alert(1)', 'file:///book.txt', 'https://user:secret@library.test', '{}', '{bad']) expect(() => parseLibraryQr(text)).toThrow();
});
it('TXT 中的 BOM 和 JSON 书源规则可解析，纯网址列表给出明确原因', () => {
  vi.stubGlobal('document', parseHTML('<html></html>').document);
  const source = { bookSourceName: 'TXT书源', bookSourceUrl: 'http://library.test', searchUrl: '/?q={{key}}', ruleSearch: { bookList: '.book', name: 'a@text', bookUrl: 'a@href' }, ruleToc: { chapterList: '.toc a', chapterName: '@text', chapterUrl: '@href' }, ruleContent: { content: '#body@html' } };
  expect(parseSources('\uFEFF' + JSON.stringify([source])).sources).toHaveLength(1);
  expect(() => parseSources('http://library.test/source')).toThrow('纯网址列表');
});
it('HTTP 直链确实进入下载通道并返回文件内容', async () => {
  vi.stubGlobal('window', {});
  const fetch = vi.fn(async () => new Response('正文', { headers: { 'content-type': 'text/plain' } }));
  vi.stubGlobal('fetch', fetch);
  const result = await requestBytes('http://192.168.1.17:8765/book.txt');
  expect(new TextDecoder().decode(result.data)).toBe('正文');
  expect(fetch.mock.calls).toHaveLength(1);
});
