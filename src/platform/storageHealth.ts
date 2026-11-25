export interface StorageHealth { usage: number; quota: number; persistent: boolean | null }
export async function storageHealth(): Promise<StorageHealth> {
  const storage = navigator.storage;
  const estimate = await storage?.estimate?.().catch(() => ({} as StorageEstimate));
  const persistent = await storage?.persisted?.().catch(() => null);
  return { usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0, persistent: persistent ?? null };
}
export async function requestPersistentStorage(): Promise<boolean> {
  return await navigator.storage?.persist?.().catch(() => false) ?? false;
}
