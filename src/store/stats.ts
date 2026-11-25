/** 阅读统计（V0.2.0，参考 Anx Reader）：按天记录阅读时长，支持按书细分 */
import { platform } from '../platform/web';

export interface DayStat {
  seconds: number;
  byBook: Record<string, number>;
}

export function dayKey(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 86400000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 累加阅读时长（阅读页每分钟可见时调用一次） */
export async function addReadingTime(bookId: string, seconds: number): Promise<void> {
  const key = `stats:${dayKey()}`;
  const day = (await platform.kvGet<DayStat>(key)) ?? { seconds: 0, byBook: {} };
  day.seconds += seconds;
  day.byBook[bookId] = (day.byBook[bookId] ?? 0) + seconds;
  await platform.kvSet(key, day);
}

export async function getDayStat(key: string): Promise<DayStat | null> {
  return await platform.kvGet<DayStat>(`stats:${key}`);
}

export function fmtDuration(sec: number): string {
  if (sec <= 0) return '0 分钟';
  if (sec < 60) return `${Math.round(sec)} 秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟`;
  return `${(sec / 3600).toFixed(1)} 小时`;
}
