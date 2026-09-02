import { describe, expect, it } from 'vitest'

import {
  advanceMonthlyReset,
  isoToLocalMinute,
  localMinuteToIso,
  manualResetStorageKey,
} from '@/lib/manualReset'

describe('manual traffic reset', () => {
  it('按实例生成隔离的本地存储键', () => {
    expect(manualResetStorageKey({ provider: 'aliyun/swas', instanceKey: 'vm 1' })).toBe(
      'trafficReset.aliyun%2Fswas.vm%201',
    )
  })

  it('datetime-local 精确到分钟并转换为合法 ISO 时间', () => {
    const iso = localMinuteToIso('2026-08-11T10:18')
    expect(iso).toBeDefined()
    expect(isoToLocalMinute(iso)).toBe('2026-08-11T10:18')
  })

  it('拒绝空值和不完整时间', () => {
    expect(localMinuteToIso('')).toBeUndefined()
    expect(localMinuteToIso('2026-08-11')).toBeUndefined()
  })

  it('到期后推进到下个月同一日期和时间', () => {
    const initial = localMinuteToIso('2026-08-10T12:34')!
    const now = new Date('2026-09-10T12:34').getTime()
    expect(isoToLocalMinute(advanceMonthlyReset(initial, now))).toBe('2026-10-10T12:34')
  })

  it('跨过多个月时直接补到下一个未来时间', () => {
    const initial = localMinuteToIso('2026-01-15T08:20')!
    const now = new Date('2026-04-20T00:00').getTime()
    expect(isoToLocalMinute(advanceMonthlyReset(initial, now))).toBe('2026-05-15T08:20')
  })

  it('保留月底锚点日期', () => {
    const initial = localMinuteToIso('2026-01-31T09:45')!
    const february = advanceMonthlyReset(initial, new Date('2026-02-01T00:00').getTime(), 31)!
    expect(isoToLocalMinute(february)).toBe('2026-02-28T09:45')
    expect(
      isoToLocalMinute(advanceMonthlyReset(february, new Date('2026-03-01T00:00').getTime(), 31)),
    ).toBe('2026-03-31T09:45')
  })
})
