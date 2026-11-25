/** 持久化前缀；同时用于备份和同步批量查询。 */
export const STORAGE_PREFIX = {
  progress: 'progress:', annotations: 'annotations:', style: 'style:', file: 'file:', font: 'font:',
} as const;
export const storageKey = (type: keyof typeof STORAGE_PREFIX, id: string) => STORAGE_PREFIX[type] + id;
