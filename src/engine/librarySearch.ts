import { platform } from '../platform/web';
import { searchBook, type SearchResult } from './search';
import type { BookMeta } from './types';

export interface LibrarySearchHit extends SearchResult { bookId: string; bookTitle: string }
/** 每次只读取一本书，章节间让出主线程；取消后不再发布结果。 */
export async function searchLibrary(books: BookMeta[], query: string, signal: AbortSignal,
  publish: (hits: LibrarySearchHit[], done: number) => void, limit = 200): Promise<void> {
  const hits: LibrarySearchHit[] = [];
  if (!query.trim()) return;
  for (let i = 0; i < books.length && hits.length < limit; i++) {
    signal.throwIfAborted();
    const book = books[i];
    const chapters = await platform.getChapters(book.id);
    for (let chapter = 0; chapter < (chapters?.length ?? 0) && hits.length < limit; chapter++) {
      signal.throwIfAborted();
      for (const hit of searchBook([chapters![chapter]], query, limit - hits.length)) {
        hits.push({ ...hit, chapter, bookId: book.id, bookTitle: book.title });
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    publish([...hits], i + 1);
  }
}
