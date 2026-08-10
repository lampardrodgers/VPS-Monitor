import { useEffect, useState } from 'react'

/** 供相对时间使用的心跳时钟，默认每 15 秒推进一次。 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return now
}
