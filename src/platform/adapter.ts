/** 平台适配层接口（方案 5.7）：壳只实现此接口，阅读内核不感知平台 */
import type { BookMeta, Chapter } from '../engine/types';

export interface PlatformAdapter {
  id: string;
  kvGet<T>(key: string): Promise<T | null>;
  kvSet(key: string, value: unknown): Promise<void>;
  kvDel(key: string): Promise<void>;
  kvEntries<T>(prefix: string): Promise<Array<{ k: string; v: T }>>;
  kvKeys(): Promise<string[]>;
  getCover(id: string): Promise<string | undefined>;
  putMeta(meta: BookMeta): Promise<void>;
  putMetas(metas: BookMeta[], kv?: Array<{ k: string; v: unknown }>): Promise<void>;
  putBook(meta: BookMeta, chapters: Chapter[], raw?: ArrayBuffer): Promise<void>;
  listBooks(): Promise<BookMeta[]>;
  getChapters(id: string): Promise<Chapter[] | null>;
  deleteBook(id: string): Promise<void>;
  recycleBook(id: string): Promise<void>;
  /** 本地整库备份（V0.3.0）：读出全部数据 */
  dumpAll(): Promise<{ metas: BookMeta[]; contents: Array<{ id: string; chapters: Chapter[] }>; kv: Array<{ k: string; v: unknown }> }>;
  /** Restore metadata, content, covers and settings atomically; merge retains unrelated books. */
  replaceAll(metas: BookMeta[], contents: Array<{ id: string; chapters: Chapter[] }>, kv: Array<{ k: string; v: unknown }>, merge?: boolean, deleteKeys?: string[]): Promise<void>;
}
