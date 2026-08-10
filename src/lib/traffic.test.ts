import { describe, expect, it } from 'vitest'

import { describeTraffic, trafficSortValue, trafficTone } from '@/lib/traffic'

const GB = 1024 ** 3

describe('describeTraffic', () => {
  it('识别无限流量，即使同时返回了已用量', () => {
    const model = describeTraffic({
      traffic_unlimited: true,
      traffic_billing_mode: 'bandwidth',
      traffic_used_bytes: 5 * GB,
    })
    expect(model.kind).toBe('unlimited')
    if (model.kind !== 'unlimited') throw new Error('类型收窄失败')
    expect(model.billingMode).toBe('bandwidth')
    expect(model.used).toBe(5 * GB)
  })

  it('有总配额时计算百分比与剩余量', () => {
    const model = describeTraffic({
      traffic_used_bytes: 256 * GB,
      traffic_total_bytes: 512 * GB,
    })
    if (model.kind !== 'quota') throw new Error('应识别为 quota')
    expect(model.percent).toBe(50)
    expect(model.remaining).toBe(256 * GB)
    // 50% 起算警告，配色与 CPU / 内存 / 磁盘一致。
    expect(model.tone).toBe('warn')
  })

  it('只有剩余量时反推已用量', () => {
    const model = describeTraffic({
      traffic_total_bytes: 100,
      traffic_remaining_bytes: 40,
    })
    if (model.kind !== 'quota') throw new Error('应识别为 quota')
    expect(model.used).toBe(60)
    expect(model.percent).toBe(60)
  })

  it('只有已用量、没有任何配额字段时按不限流量处理，并保留真实用量', () => {
    const model = describeTraffic({ traffic_used_bytes: 11 * GB })
    expect(model.kind).toBe('unlimited')
    if (model.kind !== 'unlimited') throw new Error('类型收窄失败')
    expect(model.source).toBe('inferred')
    expect(model.used).toBe(11 * GB)
  })

  it('供应商声明的无限流量标记为 declared', () => {
    const model = describeTraffic({ traffic_unlimited: true })
    if (model.kind !== 'unlimited') throw new Error('类型收窄失败')
    expect(model.source).toBe('declared')
    expect(model.used).toBeUndefined()
  })

  it('完全没有流量字段时返回 none', () => {
    expect(describeTraffic({}).kind).toBe('none')
    expect(describeTraffic(undefined).kind).toBe('none')
  })

  it('支持 rx/tx 别名', () => {
    const model = describeTraffic({ traffic_rx_bytes: 10, traffic_tx_bytes: 20, traffic_used_bytes: 30 })
    if (model.kind !== 'unlimited') throw new Error('类型收窄失败')
    expect(model.inBytes).toBe(10)
    expect(model.outBytes).toBe(20)
  })

  it('保留流量重置时间，三种形态都能拿到', () => {
    const resetAt = '2026-08-11T02:18:48+00:00'
    const quota = describeTraffic({
      traffic_used_bytes: 5,
      traffic_total_bytes: 10,
      traffic_reset_at: resetAt,
    })
    if (quota.kind !== 'quota') throw new Error('应识别为 quota')
    expect(quota.resetAt).toBe(resetAt)

    const unlimited = describeTraffic({ traffic_unlimited: true, traffic_reset_at: resetAt })
    if (unlimited.kind !== 'unlimited') throw new Error('应识别为 unlimited')
    expect(unlimited.resetAt).toBe(resetAt)
  })

  it('总配额为 0 时不当作固定配额', () => {
    const model = describeTraffic({ traffic_total_bytes: 0, traffic_used_bytes: 5 })
    expect(model.kind).toBe('unlimited')
  })
})

describe('trafficTone', () => {
  it('与其它使用率条同一套阈值：50% 黄、80% 红', () => {
    expect(trafficTone(49.9)).toBe('ok')
    expect(trafficTone(50)).toBe('warn')
    expect(trafficTone(79.9)).toBe('warn')
    expect(trafficTone(80)).toBe('crit')
  })
})

describe('trafficSortValue', () => {
  it('只有固定配额参与百分比排序，其它排到末尾', () => {
    expect(trafficSortValue(describeTraffic({ traffic_used_bytes: 5, traffic_total_bytes: 10 }))).toBe(50)
    expect(trafficSortValue(describeTraffic({ traffic_unlimited: true }))).toBeUndefined()
    expect(trafficSortValue(describeTraffic({ traffic_used_bytes: 5 }))).toBeUndefined()
    expect(trafficSortValue(describeTraffic({}))).toBeUndefined()
  })
})
