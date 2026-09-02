import type { InstanceRef } from '@/api/types'
import { parseTimestamp } from '@/lib/format'

export function manualResetStorageKey(ref: InstanceRef): string {
  return `trafficReset.${encodeURIComponent(ref.provider)}.${encodeURIComponent(ref.instanceKey)}`
}

export function manualResetAutoAdvanceStorageKey(ref: InstanceRef): string {
  return `${manualResetStorageKey(ref)}.autoAdvance`
}

export function manualResetAnchorDayStorageKey(ref: InstanceRef): string {
  return `${manualResetStorageKey(ref)}.anchorDay`
}

/** datetime-local 使用本地时区；保存时转换为带时区的 ISO 8601。 */
export function localMinuteToIso(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

/** 把服务端/本地保存的 ISO 时间还原成 datetime-local 所需格式。 */
export function isoToLocalMinute(value: string | undefined): string {
  const timestamp = parseTimestamp(value)
  if (timestamp === undefined) return ''
  const date = new Date(timestamp)
  const localTimestamp = timestamp - date.getTimezoneOffset() * 60_000
  return new Date(localTimestamp).toISOString().slice(0, 16)
}

/**
 * 把已到期的时间推进到未来的下个月同日同时间。
 * anchorDay 保留最初设置的日期，使 1 月 31 日经过 2 月后仍能回到 3 月 31 日。
 */
export function advanceMonthlyReset(
  value: string,
  now: number,
  anchorDay?: number,
): string | undefined {
  const timestamp = parseTimestamp(value)
  if (timestamp === undefined) return undefined

  let next = new Date(timestamp)
  const day =
    anchorDay !== undefined && Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31
      ? anchorDay
      : next.getDate()

  while (next.getTime() <= now) {
    next = new Date(next.getTime())
    next.setDate(1)
    next.setMonth(next.getMonth() + 1)
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    next.setDate(Math.min(day, lastDay))
  }

  return next.toISOString()
}
