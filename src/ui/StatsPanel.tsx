import { Panel } from './Panel';
/** 阅读统计面板（V0.2.0 / V0.3.1 增强）：时长汇总 + 近 14 天柱状图 + 半年热力图 + 每日目标打卡 + 最常读 */
import { useEffect, useMemo, useState } from 'react';
import { useLibrary } from '../store/library';
import { platform } from '../platform/web';
import { dayKey, fmtDuration, type DayStat } from '../store/stats';

const RANGE = 14;
const HEAT_WEEKS = 26; // 半年热力图
const GOALS = [15, 30, 60, 120];

interface Cell {
  key: string;
  sec: number;
  future: boolean;
}

export function StatsPanel({ onClose }: { onClose: () => void }) {
  const books = useLibrary((st) => st.books);
  const [days, setDays] = useState<Array<{ key: string; stat: DayStat | null }>>([]);
  const [goal, setGoal] = useState(30);
  const [grid, setGrid] = useState<Cell[]>([]);

  const [allDays, setAllDays] = useState<Record<string, DayStat>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [entries, savedGoal] = await Promise.all([
          platform.kvEntries<DayStat>('stats:'), platform.kvGet<number>('dailyGoalMin'),
        ]);
        if (!alive) return;
        const records = Object.fromEntries(entries.map(({ k, v }) => [k.slice(6), v]));
        setAllDays(records);
        if (savedGoal && savedGoal > 0) setGoal(savedGoal);
        setDays(Array.from({ length: RANGE }, (_, i) => {
          const key = dayKey(RANGE - 1 - i);
          return { key, stat: records[key] ?? null };
        }));
        const today = new Date();
        const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7);
        const cells = Array.from({ length: HEAT_WEEKS * 7 }, (_, i) => {
          const date = new Date(monday);
          date.setDate(date.getDate() - (HEAT_WEEKS - 1) * 7 + i);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          return { key, sec: records[key]?.seconds ?? 0, future: key > dayKey() };
        });
        setGrid(cells);
      } catch { if (alive) setError('阅读记录暂时无法读取，请稍后重试。'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const { today, week, month, total } = useMemo(() => {
    const sum = (n: number) => Array.from({ length: n }, (_, i) => allDays[dayKey(i)]?.seconds ?? 0).reduce((a, b) => a + b, 0);
    return { today: sum(1), week: sum(7), month: sum(30),
      total: Object.values(allDays).reduce((a, d) => a + d.seconds, 0) };
  }, [allDays]);

  const todayMin = Math.floor(today / 60);
  const goalDone = todayMin >= goal;
  const goalPct = Math.min(100, Math.round((todayMin / goal) * 100));

  // 连续达标：今天达标则含今天；尚未达标则从昨天起数
  const streak = useMemo(() => {
    const met = (offset: number) => (allDays[dayKey(offset)]?.seconds ?? 0) >= goal * 60;
    let n = met(0) ? 1 : 0;
    for (let i = 1; i <= Object.keys(allDays).length; i++) {
      if (met(i)) n += 1;
      else break;
    }
    return n;
  }, [allDays, goal]);

  const maxSec = Math.max(60, ...days.map((d) => d.stat?.seconds ?? 0));
  const topBooks = useMemo(() => {
    const agg = new Map<string, number>();
    for (const d of days) {
      if (!d.stat) continue;
      for (const [id, sec] of Object.entries(d.stat.byBook)) {
        agg.set(id, (agg.get(id) ?? 0) + sec);
      }
    }
    return [...agg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, sec]) => ({ title: books.find((b) => b.id === id)?.title ?? '未知书籍', sec }));
  }, [days, books]);

  const pickGoal = async (g: number) => {
    try { await platform.kvSet('dailyGoalMin', g); setGoal(g); }
    catch { setError('目标未能保存，请重试。'); }
  };

  return (
    <Panel label="阅读统计" onClose={onClose}>
        <div className="drawer-head">
          <h3>阅读统计</h3>
          <button onClick={onClose}>完成</button>
        </div>

        <p className="panel-intro">日积一页，自有所得。</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="stat-cards" aria-busy={loading}>
          <div className="stat-card">
            <span className="stat-num">{loading ? '—' : fmtDuration(today) }</span>
            <span className="stat-label">今日</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">{loading ? '—' : fmtDuration(week) }</span>
            <span className="stat-label">近 7 天</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">{loading ? '—' : fmtDuration(month) }</span>
            <span className="stat-label">近 30 天</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">{loading ? '—' : fmtDuration(total) }</span>
            <span className="stat-label">累计</span>
          </div>
        </div>

        <div className="set-group">
          <label>
            每日目标
            {goalDone ? <span className="goal-done">✓ 已达标</span> : null}
          </label>
          <div className="goal-row">
            <div className="goal-bar">
              <div className="goal-fill" style={{ width: `${goalPct}%` }} data-done={goalDone || undefined} />
            </div>
            <span className="goal-num">
              {todayMin} / {goal} 分钟
            </span>
          </div>
          <div className="seg">
            {GOALS.map((g) => (
              <button key={g} className={goal === g ? 'active' : ''} onClick={() => void pickGoal(g)}>
                {g >= 60 ? `${g / 60} 小时` : `${g} 分钟`}
              </button>
            ))}
          </div>
          <p className="set-hint">连续达标 {streak} 天 · 目标存于本机</p>
        </div>

        <details className="panel-details">
          <summary>半年足迹<span>近 {HEAT_WEEKS} 周</span></summary>
          <div className="heatmap" role="img" aria-label="阅读热力图">
            {grid.map((c, i) => {
              const min = c.sec / 60;
              const lv = c.future ? -1 : min <= 0 ? 0 : min < 15 ? 1 : min < 30 ? 2 : min < 60 ? 3 : 4;
              return (
                <div
                  key={i}
                  className={`hm-cell l${lv}`}
                  title={`${c.key}${c.future ? '' : ` · ${fmtDuration(c.sec)}`}`}
                />
              );
            })}
          </div>
          <div className="hm-legend">
            <span>少</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <div key={l} className={`hm-cell l${l}`} />
            ))}
            <span>多</span>
          </div>
        </details>

        <div className="set-group">
          <label>近 {RANGE} 天</label>
          <div className="stat-bars">
            {days.map((d) => {
              const sec = d.stat?.seconds ?? 0;
              const h = Math.max(2, Math.round((sec / maxSec) * 88));
              return (
                <div key={d.key} className="stat-bar-col" title={`${d.key} · ${fmtDuration(sec)}`}>
                  <div className="stat-bar" style={{ height: `${h}px` }} data-has={sec > 0 || undefined} />
                  <span className="stat-bar-day">{d.key.slice(8)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="set-group">
          <label>最常读（近 {RANGE} 天）</label>
          {topBooks.length === 0 ? (
            <p className="set-hint">尚无阅读记录。从今天的一页开始。</p>
          ) : (
            topBooks.map((b, i) => (
              <div key={i} className="stat-book-row">
                <span className="stat-book-rank">{i + 1}</span>
                <span className="stat-book-title">{b.title}</span>
                <span className="stat-book-time">{fmtDuration(b.sec)}</span>
              </div>
            ))
          )}
        </div>
    </Panel>
  );
}
