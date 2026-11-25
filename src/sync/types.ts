/** 同步层类型（V0.1.0 L1：进度/笔记/书架元数据；V0.2.0：正文/文件备份 + 本书独立方案） */
import type { Annotation, BookMeta, CatNode, Progress, ReaderSettings } from '../engine/types';

/** 单个 WebDAV 同步账号（V0.4.0 多账号；V0.3.x 单账号配置升级时自动迁移为首个账号） */
export interface SyncAccount {
  id: string;
  /** 参与同步（全局自动同步关闭时所有账号都不跑） */
  enabled: boolean;
  url: string; // 如坚果云 https://dav.jianguoyun.com/dav/，任意标准 WebDAV 均可
  username: string;
  password: string; // 应用密码（坚果云/InfiniCLOUD/Nextcloud 等均非登录密码）
  basePath: string; // 阅读树
  backupBooks: boolean; // V0.2.0：上传书籍正文与原文件（消耗上行流量，多账号时每个云各传一份）
  rememberPassword?: boolean;
}

export interface SyncConfig {
  intervalMinutes?: 1 | 3 | 10;
  enabled: boolean;
  accounts: SyncAccount[]; // V0.4.0：多账号同时同步、互为备份
}

/** V0.3.x 及以前的单账号配置（init 时迁移为 accounts[0]，id 固定 main） */
export interface LegacySyncConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  basePath: string;
  backupBooks: boolean;
  rememberPassword?: boolean;
  intervalMinutes?: 1 | 3 | 10;
}

export interface SyncTombstones {
  books: string[];
  nodes: string[];
}

/** 章节化 HTML 正文（阅读器的内容真源，用于换机恢复） */
export interface RemoteChapter {
  title: string;
  html: string;
  chars: number;
}

/** 远端全局清单：meta 不含 cover（封面在书文件里，控制 manifest 体积） */
export interface RemoteManifest {
  version: 1;
  updatedAt: number;
  device: string;
  nodes: CatNode[];
  deletedNodeIds: string[];
  books: Array<BookMeta & { rev: number }>;
  deletedBookIds: string[];
}

/** 单本书云端文件 */
export interface RemoteBook {
  bookId: string;
  updatedAt: number;
  device: string;
  meta: BookMeta; // 含 cover
  progress: Progress | null;
  annotations: Annotation[];
  deletedAnnotationIds: string[];
  rev: number;
  /** V0.2.0 资产（不参与冲突合并：本地优先透传，本地缺失时从远端恢复） */
  content?: RemoteChapter[];
  fileInfo?: { ext: string; size: number }; // 原始文件存档位于 files/<id>.<ext>
  style?: Partial<ReaderSettings>; // 本书独立阅读方案
}
