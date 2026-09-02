/**
 * 历史曲线的数据准备。
 *
 * 关键约束：字段缺失写 `null`（图表断线），绝不补 0；只有一个点时也要能画出来。
 */
import type { HistoryPoint } from '@/api/types'
import { parseTimestamp } from '@/lib/format'
import { ratioToPercent, readNumber } from '@/lib/values'

export type RangeKey = '24h' | '7d' | '30d'

export interface RangeOption {
  key: RangeKey
  label: string
  hours: number
  limit: number
}

export const RANGE_OPTIONS: RangeOption[] = [
  { key: '24h', label: '24 小时', hours: 24, limit: 1000 },
  { key: '7d', label: '7 天', hours: 168, limit: 5000 },
  { key: '30d', label: '30 天', hours: 720, limit: 10000 },
]

export function rangeOption(key: RangeKey): RangeOption {
  return RANGE_OPTIONS.find((option) => option.key === key) ?? RANGE_OPTIONS[0]!
}

export interface ChartRow {
  t: number
  cpu: number | null
  memUsed: number | null
  memTotal: number | null
  memPercent: number | null
  diskUsed: number | null
  diskTotal: number | null
  diskPercent: number | null
  netIn: number | null
  netOut: number | null
  trafficUsed: number | null
  trafficIn: number | null
  trafficOut: number | null
  load: number | null
}

export type ChartField = Exclude<keyof ChartRow, 't'>

const CHART_FIELDS: ChartField[] = [
  'cpu',
  'memUsed',
  'memTotal',
  'memPercent',
  'diskUsed',
  'diskTotal',
  'diskPercent',
  'netIn',
  'netOut',
  'trafficUsed',
  'trafficIn',
  'trafficOut',
  'load',
]

function orNull(value: number | undefined): number | null {
  return value === undefined ? null : value
}

export function buildChartRows(points: readonly HistoryPoint[]): ChartRow[] {
  const rows: ChartRow[] = []
  for (const point of points) {
    const t = parseTimestamp(point.observed_at)
    if (t === undefined) continue

    const memTotal = readNumber(point.metrics, 'memory_total_bytes')
    const memAvailable = readNumber(point.metrics, 'memory_available_bytes')
    const memUsed =
      readNumber(point.metrics, 'memory_used_bytes') ??
      (memTotal !== undefined && memAvailable !== undefined
        ? Math.max(0, memTotal - memAvailable)
        : undefined)
    const diskUsed = readNumber(point.metrics, 'disk_used_bytes')
    const diskTotal = readNumber(point.metrics, 'disk_total_bytes')

    rows.push({
      t,
      cpu: orNull(readNumber(point.metrics, 'cpu_percent')),
      memUsed: orNull(memUsed),
      memTotal: orNull(memTotal),
      memPercent: orNull(ratioToPercent(memUsed, memTotal)),
      diskUsed: orNull(diskUsed),
      diskTotal: orNull(diskTotal),
      diskPercent: orNull(ratioToPercent(diskUsed, diskTotal)),
      netIn: orNull(readNumber(point.metrics, 'network_in_bps')),
      netOut: orNull(readNumber(point.metrics, 'network_out_bps')),
      trafficUsed: orNull(readNumber(point.quota, 'traffic_used_bytes')),
      trafficIn: orNull(readNumber(point.quota, 'traffic_in_bytes', 'traffic_rx_bytes')),
      trafficOut: orNull(readNumber(point.quota, 'traffic_out_bytes', 'traffic_tx_bytes')),
      load: orNull(readNumber(point.metrics, 'load_average')),
    })
  }
  return rows.sort((left, right) => left.t - right.t)
}

/** 某个字段在整段历史里是否至少出现过一次；没出现就显示“该供应商不提供”。 */
export function fieldPresence(rows: readonly ChartRow[]): Record<ChartField, boolean> {
  const presence = Object.fromEntries(CHART_FIELDS.map((field) => [field, false])) as Record<
    ChartField,
    boolean
  >
  for (const row of rows) {
    for (const field of CHART_FIELDS) {
      if (row[field] !== null) presence[field] = true
    }
  }
  return presence
}

/**
 * 等距抽稀：30 天 × 5 分钟约 8600 个点，直接渲染 5 张图会卡。
 * 每个桶取非空值的平均，桶内全空仍然保持 `null`，不会把缺口填平。
 */
export function downsample(rows: readonly ChartRow[], maxPoints: number): ChartRow[] {
  if (maxPoints <= 0 || rows.length <= maxPoints) return [...rows]

  const bucketSize = Math.ceil(rows.length / maxPoints)
  const result: ChartRow[] = []

  for (let start = 0; start < rows.length; start += bucketSize) {
    const bucket = rows.slice(start, start + bucketSize)
    if (bucket.length === 0) continue
    const row: ChartRow = {
      t: Math.round(bucket.reduce((sum, item) => sum + item.t, 0) / bucket.length),
      ...(Object.fromEntries(CHART_FIELDS.map((field) => [field, null])) as Record<
        ChartField,
        number | null
      >),
    }
    for (const field of CHART_FIELDS) {
      let sum = 0
      let count = 0
      for (const item of bucket) {
        const value = item[field]
        if (value !== null) {
          sum += value
          count += 1
        }
      }
      row[field] = count === 0 ? null : sum / count
    }
    result.push(row)
  }
  return result
}

/** X 轴刻度：范围越大标签越粗，避免拥挤。 */
export function axisTickCount(rows: readonly ChartRow[]): number {
  if (rows.length <= 2) return rows.length
  return 5
}
