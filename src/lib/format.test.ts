import { describe, expect, it } from 'vitest'

import {
  daysUntil,
  EMPTY,
  formatBitrate,
  formatBytes,
  formatCount,
  formatDurationMs,
  formatPercent,
  formatRelative,
  parseTimestamp,
} from '@/lib/format'

describe('formatBytes', () => {
  it('按 1024 进制换算并保留合适的小数位', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(536870912)).toBe('512 MB')
    expect(formatBytes(2147483648)).toBe('2.00 GB')
    expect(formatBytes(549755813888)).toBe('512 GB')
  })

  it('缺失值显示占位符而不是 0', () => {
    expect(formatBytes(undefined)).toBe(EMPTY)
    expect(formatBytes(Number.NaN)).toBe(EMPTY)
    expect(formatBytes(undefined, '不支持')).toBe('不支持')
  })
})

describe('formatBitrate', () => {
  it('按 1000 进制换算 bit/s', () => {
    expect(formatBitrate(0)).toBe('0 bps')
    expect(formatBitrate(999)).toBe('999 bps')
    expect(formatBitrate(12000)).toBe('12.0 Kbps')
    expect(formatBitrate(222512)).toBe('223 Kbps')
    expect(formatBitrate(1_500_000)).toBe('1.50 Mbps')
  })

  it('缺失值不显示 0 bps', () => {
    expect(formatBitrate(undefined)).toBe(EMPTY)
  })
})

describe('formatPercent', () => {
  it('保留一位小数', () => {
    expect(formatPercent(12.345)).toBe('12.3%')
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(99.99, { digits: 0 })).toBe('100%')
  })

  it('缺失值返回占位符', () => {
    expect(formatPercent(undefined)).toBe(EMPTY)
  })
})

describe('parseTimestamp', () => {
  it('解析带时区的 ISO 时间', () => {
    expect(parseTimestamp('2026-08-10T03:30:17+00:00')).toBe(Date.parse('2026-08-10T03:30:17Z'))
    expect(parseTimestamp('2026-08-10T03:30:17Z')).toBe(Date.parse('2026-08-10T03:30:17Z'))
  })

  it('缺少时区时按 UTC 处理', () => {
    expect(parseTimestamp('2026-08-10T03:30:17')).toBe(Date.parse('2026-08-10T03:30:17Z'))
  })

  it('非法输入返回 undefined', () => {
    expect(parseTimestamp(null)).toBeUndefined()
    expect(parseTimestamp('')).toBeUndefined()
    expect(parseTimestamp('not-a-date')).toBeUndefined()
  })
})

describe('formatRelative', () => {
  const now = Date.parse('2026-08-10T12:00:00Z')

  it('区分过去与未来', () => {
    expect(formatRelative('2026-08-10T11:55:00Z', now)).toBe('5 分钟前')
    expect(formatRelative('2026-08-10T12:30:00Z', now)).toBe('30 分钟后')
    expect(formatRelative('2026-08-10T11:59:57Z', now)).toBe('刚刚')
  })

  it('跨小时和天数时切换单位', () => {
    expect(formatRelative('2026-08-10T09:00:00Z', now)).toBe('3 小时前')
    expect(formatRelative('2026-08-08T12:00:00Z', now)).toBe('2 天前')
  })
})

describe('formatDurationMs', () => {
  it('覆盖秒 / 分 / 小时 / 天', () => {
    expect(formatDurationMs(5_000)).toBe('5 秒')
    expect(formatDurationMs(180_000)).toBe('3 分钟')
    expect(formatDurationMs(3 * 3600_000 + 1800_000)).toBe('3 小时 30 分钟')
    expect(formatDurationMs(50 * 3600_000)).toBe('2 天 2 小时')
  })
})

describe('daysUntil', () => {
  const now = Date.parse('2026-08-10T00:00:00Z')

  it('计算剩余天数，过期返回负数', () => {
    expect(daysUntil('2026-08-20T00:00:00Z', now)).toBe(10)
    expect(daysUntil('2026-08-05T00:00:00Z', now)).toBe(-5)
    expect(daysUntil(undefined, now)).toBeUndefined()
  })
})

describe('formatCount', () => {
  it('缺失时不显示 0', () => {
    expect(formatCount(6)).toBe('6')
    expect(formatCount(undefined)).toBe(EMPTY)
  })
})
