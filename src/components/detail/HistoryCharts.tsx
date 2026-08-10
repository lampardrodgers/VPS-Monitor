import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipPayloadEntry,
} from 'recharts'

import type { InstanceHistoryResponse } from '@/api/types'
import { chartTheme } from '@/components/detail/chartTheme'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePreferences } from '@/hooks/preferences'
import { cn } from '@/lib/cn'
import { formatBitrate, formatBytes, formatClock, formatDayClock, formatPercent } from '@/lib/format'
import {
  buildChartRows,
  downsample,
  fieldPresence,
  type ChartField,
  type ChartRow,
  type RangeKey,
} from '@/lib/series'

type Unit = 'percent' | 'bytes' | 'bps' | 'number'

const MAX_CHART_POINTS = 720

function formatValue(value: number | null | undefined, unit: Unit): string {
  if (value === null || value === undefined) return '无数据'
  switch (unit) {
    case 'percent':
      return formatPercent(value)
    case 'bytes':
      return formatBytes(value)
    case 'bps':
      return formatBitrate(value)
    default:
      return value.toFixed(2)
  }
}

function axisFormatter(unit: Unit): (value: number) => string {
  return (value: number) => {
    switch (unit) {
      case 'percent':
        return `${Math.round(value)}%`
      case 'bytes':
        return formatBytes(value)
      case 'bps':
        return formatBitrate(value)
      default:
        return String(Math.round(value * 100) / 100)
    }
  }
}

interface SeriesSpec {
  field: ChartField
  label: string
  colorIndex: 0 | 1 | 2 | 3
  dashed?: boolean
}

interface ChartSpec {
  id: string
  title: string
  unit: Unit
  series: SeriesSpec[]
  /** 参考线字段（例如内存总量），有值时画一条虚线。 */
  referenceField?: ChartField
  referenceLabel?: string
  percentDomain?: boolean
}

/** 图表清单。新增指标只需要在这里追加一项。 */
const CHARTS: ChartSpec[] = [
  {
    id: 'cpu',
    title: 'CPU 使用率',
    unit: 'percent',
    series: [{ field: 'cpu', label: 'CPU', colorIndex: 0 }],
    percentDomain: true,
  },
  {
    id: 'memory',
    title: '内存使用量',
    unit: 'bytes',
    series: [{ field: 'memUsed', label: '已用内存', colorIndex: 1 }],
    referenceField: 'memTotal',
    referenceLabel: '总内存',
  },
  {
    id: 'disk',
    title: '磁盘使用量',
    unit: 'bytes',
    series: [{ field: 'diskUsed', label: '已用磁盘', colorIndex: 2 }],
    referenceField: 'diskTotal',
    referenceLabel: '总磁盘',
  },
  {
    id: 'network',
    title: '网络速率',
    unit: 'bps',
    series: [
      { field: 'netIn', label: '入站', colorIndex: 0 },
      { field: 'netOut', label: '出站', colorIndex: 3 },
    ],
  },
  {
    id: 'traffic',
    title: '流量累计',
    unit: 'bytes',
    series: [
      { field: 'trafficUsed', label: '周期已用', colorIndex: 2 },
      { field: 'trafficIn', label: '入站累计', colorIndex: 0, dashed: true },
      { field: 'trafficOut', label: '出站累计', colorIndex: 3, dashed: true },
    ],
  },
]

interface ChartTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<TooltipPayloadEntry>
  label?: string | number
  unit: Unit
  range: RangeKey
}

function ChartTooltip({ active, payload, label, unit, range }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const time = typeof label === 'number' ? label : Number(label)

  return (
    <div className="rounded border border-line bg-panel/95 px-2.5 py-2 shadow-lg backdrop-blur-sm">
      <div className="tnum mb-1 text-[10px] text-fg-faint">
        {Number.isFinite(time)
          ? range === '24h'
            ? formatClock(time)
            : formatDayClock(time)
          : String(label)}
      </div>
      <div className="space-y-0.5">
        {payload.map((entry) => (
          <div
            key={String(entry.dataKey)}
            className="flex items-center justify-between gap-4 text-[11px]"
          >
            <span className="flex items-center gap-1.5 text-fg-dim">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="tnum text-fg">
              {formatValue(typeof entry.value === 'number' ? entry.value : null, unit)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function lastValue(rows: readonly ChartRow[], field: ChartField): number | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index]?.[field]
    if (value !== null && value !== undefined) return value
  }
  return null
}

function ChartCard({
  spec,
  rows,
  presence,
  range,
}: {
  spec: ChartSpec
  rows: ChartRow[]
  presence: Record<ChartField, boolean>
  range: RangeKey
}) {
  const { theme } = usePreferences()
  const colors = chartTheme(theme)
  const visibleSeries = spec.series.filter((series) => presence[series.field])
  const supported = visibleSeries.length > 0

  const referenceValue =
    spec.referenceField && presence[spec.referenceField]
      ? lastValue(rows, spec.referenceField)
      : null

  const headline = supported ? lastValue(rows, visibleSeries[0]!.field) : null

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <h4 className="text-[11px] font-medium tracking-wide text-fg-dim uppercase">{spec.title}</h4>
        {supported ? (
          <span className="tnum text-[11px] text-fg">{formatValue(headline, spec.unit)}</span>
        ) : null}
      </div>

      {!supported ? (
        <div className="flex h-[132px] items-center justify-center px-3 text-center">
          <p className="text-[11px] text-fg-faint">
            该供应商不提供此指标
            <span className="mt-1 block text-[10px] opacity-70">
              字段缺失不代表数值为 0，因此不绘制曲线
            </span>
          </p>
        </div>
      ) : (
        <div className="h-[132px] px-1 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rows}
              syncId="instance-history"
              margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value: number) =>
                  range === '24h' ? formatClock(value) : formatDayClock(value)
                }
                tick={{ fill: colors.axis, fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: colors.grid }}
                minTickGap={40}
              />
              <YAxis
                width={74}
                tick={{ fill: colors.axis, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickCount={4}
                tickFormatter={axisFormatter(spec.unit)}
                // 有参考线（总内存 / 总磁盘）时把它一起纳入值域，否则上限会被裁掉。
                domain={
                  spec.percentDomain
                    ? [0, (dataMax: number) => Math.min(100, Math.max(5, dataMax * 1.25))]
                    : [
                        0,
                        (dataMax: number) => {
                          const upper = Math.max(dataMax, referenceValue ?? 0)
                          return upper > 0 ? upper * 1.12 : 1
                        },
                      ]
                }
              />
              <Tooltip
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={props.payload}
                    label={props.label}
                    unit={spec.unit}
                    range={range}
                  />
                )}
                cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }}
                isAnimationActive={false}
              />
              {referenceValue !== null ? (
                <ReferenceLine
                  y={referenceValue}
                  stroke={colors.reference}
                  strokeDasharray="4 4"
                  label={{
                    value: `${spec.referenceLabel ?? '上限'} ${formatValue(referenceValue, spec.unit)}`,
                    position: 'insideTopRight',
                    fill: colors.axis,
                    fontSize: 9,
                  }}
                />
              ) : null}
              {visibleSeries.map((series) => (
                <Line
                  key={series.field}
                  type="monotone"
                  name={series.label}
                  dataKey={series.field}
                  stroke={colors.series[series.colorIndex]}
                  strokeWidth={1.6}
                  strokeDasharray={series.dashed ? '4 3' : undefined}
                  // 缺失字段留空，绝不连线补零；单点历史靠 dot 显示。
                  connectNulls={false}
                  dot={rows.length <= 2 ? { r: 2.5 } : false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {supported && visibleSeries.length > 1 ? (
        <div className="flex flex-wrap gap-3 border-t border-line px-3 py-1.5">
          {visibleSeries.map((series) => (
            <span key={series.field} className="flex items-center gap-1.5 text-[10px] text-fg-faint">
              <span
                aria-hidden="true"
                className={cn('inline-block h-0.5 w-3')}
                style={{
                  backgroundColor: colors.series[series.colorIndex],
                  opacity: series.dashed ? 0.6 : 1,
                }}
              />
              {series.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function HistoryCharts({
  history,
  loading,
  range,
}: {
  history: InstanceHistoryResponse | undefined
  loading: boolean
  range: RangeKey
}) {
  const rows = useMemo(
    () => (history ? downsample(buildChartRows(history.points), MAX_CHART_POINTS) : []),
    [history],
  )
  const presence = useMemo(() => fieldPresence(rows), [rows])

  if (loading) {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {CHARTS.map((spec) => (
          <div key={spec.id} className="panel p-3">
            <Skeleton className="mb-3 h-3 w-24" />
            <Skeleton className="h-[110px] w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="panel px-4 py-10 text-center text-xs text-fg-faint">
        选定时间范围内没有历史数据。后端每 5 分钟采集一次，新加入的实例需要等待首次采集。
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {rows.length === 1 ? (
        <p className="text-[11px] text-warn">
          该范围内只有 1 个采集点，曲线以单点显示。
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {CHARTS.map((spec) => (
          <ChartCard key={spec.id} spec={spec} rows={rows} presence={presence} range={range} />
        ))}
      </div>
    </div>
  )
}
