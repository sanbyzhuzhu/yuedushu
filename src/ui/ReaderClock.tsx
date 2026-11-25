import { useEffect, useState } from 'react';

/** 时钟更新仅影响页脚，避免定时重渲染整章正文。 */
export function ReaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  return <>{String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</>;
}
