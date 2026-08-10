/**
 * 统一格式化：容量按 1024 进制（Byte），网络速率按 1000 进制（bit/s），
 * 时间一律从 UTC 转成本地时区显示。
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'] as const
const BIT_UNITS = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'] as const

export const EMPTY = '—'

function round(value: number, digits: number): string {
  return value.toFixed(digits)
}

/** 小数位随量级递减：1023 B / 9.8 GB / 128 GB 都保持约 3–4 位有效数字。 */
function autoDigits(value: number): number {
  const abs = Math.abs(value)
  if (abs >= 100) return 0
  if (abs >= 10) return 1
  return 2
}

export function formatBytes(bytes: number | undefined, fallback = EMPTY): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return fallback
  if (bytes === 0) return '0 B'
  const negative = bytes < 0
  let value = Math.abs(bytes)
  let index = 0
  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024
    index += 1
  }
  const digits = index === 0 ? 0 : autoDigits(value)
  return `${negative ? '-' : ''}${round(value, digits)} ${BYTE_UNITS[index]}`
}

export function formatBitrate(bps: number | undefined, fallback = EMPTY): string {
  if (bps === undefined || !Number.isFinite(bps)) return fallback
  if (bps === 0) return '0 bps'
  const negative = bps < 0
  let value = Math.abs(bps)
  let index = 0
  while (value >= 1000 && index < BIT_UNITS.length - 1) {
    value /= 1000
    index += 1
  }
  const digits = index === 0 ? 0 : autoDigits(value)
  return `${negative ? '-' : ''}${round(value, digits)} ${BIT_UNITS[index]}`
}

export function formatPercent(
  value: number | undefined,
  { digits = 1, fallback = EMPTY }: { digits?: number; fallback?: string } = {},
): string {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return `${round(value, digits)}%`
}

export function formatNumber(
  value: number | undefined,
  { digits = 2, fallback = EMPTY }: { digits?: number; fallback?: string } = {},
): string {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return round(value, digits)
}

export function formatCount(value: number | undefined, fallback = EMPTY): string {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return new Intl.NumberFormat('zh-CN').format(value)
}

/**
 * 解析后端时间。缺少时区后缀时按 UTC 处理，符合 API 文档“时间使用 UTC ISO 8601”。
 */
export function parseTimestamp(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  const normalized = hasZone ? value : `${value}Z`
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const dayFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour12: false,
})

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatDateTime(value: string | number | null | undefined): string {
  const ms = typeof value === 'number' ? value : parseTimestamp(value)
  if (ms === undefined) return EMPTY
  return dateTimeFormatter.format(new Date(ms)).replace(/\//g, '-')
}

export function formatDate(value: string | number | null | undefined): string {
  const ms = typeof value === 'number' ? value : parseTimestamp(value)
  if (ms === undefined) return EMPTY
  return dateFormatter.format(new Date(ms)).replace(/\//g, '-')
}

export function formatClock(value: number): string {
  return timeFormatter.format(new Date(value))
}

export function formatDayClock(value: number): string {
  return `${dayFormatter.format(new Date(value)).replace(/\//g, '-')} ${timeFormatter.format(
    new Date(value),
  )}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatDurationMs(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < MINUTE) return `${Math.max(1, Math.round(abs / 1000))} 秒`
  if (abs < HOUR) return `${Math.round(abs / MINUTE)} 分钟`
  if (abs < DAY) {
    const hours = Math.floor(abs / HOUR)
    const minutes = Math.round((abs % HOUR) / MINUTE)
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
  }
  const days = Math.floor(abs / DAY)
  const hours = Math.round((abs % DAY) / HOUR)
  return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`
}

/** 相对时间：过去写“x 前”，未来写“x 后”，10 秒内写“刚刚”。 */
export function formatRelative(
  value: string | number | null | undefined,
  now: number = Date.now(),
): string {
  const ms = typeof value === 'number' ? value : parseTimestamp(value)
  if (ms === undefined) return EMPTY
  const delta = now - ms
  if (Math.abs(delta) < 10_000) return '刚刚'
  return delta >= 0 ? `${formatDurationMs(delta)}前` : `${formatDurationMs(delta)}后`
}

/** 到期时间：返回剩余天数，用于到期预警。 */
export function daysUntil(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  const ms = parseTimestamp(value)
  if (ms === undefined) return undefined
  return Math.floor((ms - now) / DAY)
}
