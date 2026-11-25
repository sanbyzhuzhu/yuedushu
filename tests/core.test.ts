import { describe, expect, it } from 'vitest';
import { joinUrl } from '../src/sync/webdav';
import { mergeBook } from '../src/sync/merge';
import { decodeText, splitTxtChapters, txtToHtml } from '../src/engine/txt';
import type { RemoteBook } from '../src/sync/types';
const book = (time: number, note: string): RemoteBook => ({ bookId: 'b', updatedAt: time, device: 'test', rev: time,
  meta: { id: 'b', title: '书', author: '', format: 'txt', size: 1, addedAt: 1, nodeId: null }, progress: null,
  annotations: [{ id: 'a', bookId: 'b', chapter: 0, kind: 'highlight', exact: '句', prefix: '', suffix: '', color: 'red', note, createdAt: 1, updatedAt: time }], deletedAnnotationIds: [] });
describe('同步合并', () => {
  it('保留较新的本地批注', () => expect(mergeBook({ local: book(20, '新'), remote: book(10, '旧'), deviceId: 'd' }).merged?.annotations[0].note).toBe('新'));
  it('交换设备后结果一致', () => expect(mergeBook({ local: book(10, '旧'), remote: book(20, '新'), deviceId: 'd' }).merged?.annotations[0].note).toBe('新'));
  it('墓碑优先于批注内容', () => { const remote = book(10, '旧'); remote.deletedAnnotationIds = ['a']; expect(mergeBook({ local: book(20, '新'), remote, deviceId: 'd' }).merged?.annotations).toEqual([]); });
});
describe('地址与文本', () => {
  it('对中文路径编码且保留协议', () => expect(joinUrl('https://example.com/dav/', '/阅读树/', 'a b.json')).toBe('https://example.com/dav/%E9%98%85%E8%AF%BB%E6%A0%91/a%20b.json'));
  it('清除 UTF8 BOM', () => expect(decodeText(new Uint8Array([239,187,191,65]).buffer)).toBe('A'));
  it('按中文章名分章', () => expect(splitTxtChapters('第一章 初见\n正文\n第二章 再见\n结尾', '书').map(c => c.title)).toEqual(['第一章 初见','第二章 再见']));
  it('正文 HTML 转义', () => expect(txtToHtml('<script>')).not.toContain('<script>'));
});
