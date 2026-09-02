import { describe, expect, it } from 'vitest'

import type { HistoryPoint } from '@/api/types'
import { buildChartRows, downsample, fieldPresence, rangeOption } from '@/lib/series'

function point(minute: number, partial: Partial<HistoryPoint> = {}): HistoryPoint {
  return {
    observed_at: `2026-08-10T03:${String(minute).padStart(2, '0')}:00+00:00`,
    status: 'Running',
    metrics: {},
    quota: {},
    ...partial,
  }
}

describe('buildChartRows', () => {
  it('缺失字段写 null，不补 0', () => {
    const rows = buildChartRows([point(10, { metrics: { cpu_percent: 5 } }), point(15)])
    expect(rows[0]?.cpu).toBe(5)
    expect(rows[1]?.cpu).toBeNull()
    expect(rows[0]?.memUsed).toBeNull()
  })

  it('用可用内存反推使用量并计算百分比', () => {
    const rows = buildChartRows([
      point(10, { metrics: { memory_total_bytes: 1000, memory_available_bytes: 400 } }),
    ])
    expect(rows[0]?.memUsed).toBe(600)
    expect(rows[0]?.memPercent).toBe(60)
  })

  it('按时间升序排列并跳过非法时间', () => {
    const rows = buildChartRows([
      point(20, { metrics: { cpu_percent: 2 } }),
      point(10, { metrics: { cpu_percent: 1 } }),
      { observed_at: 'bad', status: null, metrics: {}, quota: {} },
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.cpu)).toEqual([1, 2])
  })

  it('支持只有一个点的历史', () => {
    const rows = buildChartRows([point(10, { metrics: { cpu_percent: 7 } })])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.cpu).toBe(7)
  })

  it('读取 rx/tx 别名的累计流量', () => {
    const rows = buildChartRows([
      point(10, { quota: { traffic_rx_bytes: 10, traffic_tx_bytes: 20 } }),
    ])
    expect(rows[0]?.trafficIn).toBe(10)
    expect(rows[0]?.trafficOut).toBe(20)
  })
})

describe('fieldPresence', () => {
  it('标记整段历史里出现过的字段', () => {
    const rows = buildChartRows([point(10), point(15, { metrics: { cpu_percent: 3 } })])
    const presence = fieldPresence(rows)
    expect(presence.cpu).toBe(true)
    expect(presence.netIn).toBe(false)
    expect(presence.trafficUsed).toBe(false)
  })
})

describe('downsample', () => {
  it('点数不足时原样返回', () => {
    const rows = buildChartRows([point(10), point(15)])
    expect(downsample(rows, 10)).toHaveLength(2)
  })

  it('抽稀后不超过目标点数，并保留全空桶的 null', () => {
    const rows = buildChartRows(
      Array.from({ length: 100 }, (_, index) =>
        point(index % 60, {
          observed_at: new Date(Date.parse('2026-08-10T00:00:00Z') + index * 60_000).toISOString(),
          metrics: index < 50 ? { cpu_percent: index } : {},
        }),
      ),
    )
    const reduced = downsample(rows, 10)
    expect(reduced.length).toBeLessThanOrEqual(10)
    expect(reduced[0]?.cpu).not.toBeNull()
    expect(reduced.at(-1)?.cpu).toBeNull()
  })

  it('桶内平均只统计非空值', () => {
    const rows = buildChartRows([
      point(10, {
        observed_at: '2026-08-10T00:00:00Z',
        metrics: { cpu_percent: 10 },
      }),
      point(11, { observed_at: '2026-08-10T00:01:00Z' }),
      point(12, {
        observed_at: '2026-08-10T00:02:00Z',
        metrics: { cpu_percent: 20 },
      }),
      point(13, {
        observed_at: '2026-08-10T00:03:00Z',
        metrics: { cpu_percent: 30 },
      }),
    ])
    const reduced = downsample(rows, 2)
    expect(reduced).toHaveLength(2)
    expect(reduced[0]?.cpu).toBe(10)
    expect(reduced[1]?.cpu).toBe(25)
  })
})

describe('rangeOption', () => {
  it('30 天视图请求 hours=720 与 limit=10000', () => {
    expect(rangeOption('30d')).toMatchObject({ hours: 720, limit: 10000 })
    expect(rangeOption('24h')).toMatchObject({ hours: 24, limit: 1000 })
    expect(rangeOption('7d')).toMatchObject({ hours: 168 })
  })
})
