import { searchSource, sourceChapters, downloadChapters } from './networkLibrary';
import type { BookSource } from './networkLibrary';

export interface SourceAuditResult {
  index: number;
  status: 'readable' | 'empty' | 'failed';
  detail: string;
}

// A failed probe is a candidate for review, never a reason for automatic deletion.
export async function auditSources(sources: BookSource[], query: string, signal: AbortSignal,
  report: (result: SourceAuditResult) => void, timeoutMs = 25000) {
  if (!query.trim()) throw new Error('请输入检测书名');
  let cursor = 0;
  async function worker() {
    while (cursor < sources.length) {
      signal.throwIfAborted();
      const index = cursor++, controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('检测超时，请稍后复检')), timeoutMs);
      let stage = '搜索';
      try {
        const books = await searchSource(sources[index], query, 1, controller.signal);
        controller.signal.throwIfAborted();
        if (!books.length) {
          report({ index, status: 'empty', detail: '没有搜索结果，可更换书名复检' });
          continue;
        }
        stage = '目录';
        const chapters = await sourceChapters(sources[index], books[0], controller.signal);
        if (!chapters.length) throw new Error('没有提取到章节');
        stage = '正文';
        await downloadChapters(sources[index], books[0], chapters.slice(0, 1), controller.signal, () => {});
        controller.signal.throwIfAborted();
        report({ index, status: 'readable', detail: `已读取《${books[0].title}》首章` });
      } catch (error) {
        signal.throwIfAborted();
        report({ index, status: 'failed', detail: `${stage}：${controller.signal.aborted ? '检测超时，请稍后复检' : error instanceof Error ? error.message : String(error)}` });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, sources.length) }, worker));
}
