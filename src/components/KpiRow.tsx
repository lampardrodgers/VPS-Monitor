import { Gauge, Infinity as InfinityIcon, Layers, Server, Share2 } from 'lucide-react'
import type { ReactNode } from 'react'

import type { SummaryResponse } from '@/api/types'
import type { TrafficRollup } from '@/lib/instance'
import { Meter } from '@/components/ui/Meter'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { EMPTY, formatBytes, formatCount, formatPercent } from '@/lib/format'
import { trafficTone } from '@/lib/traffic'
import type { Tone } from '@/lib/status'

function Tile({
  icon,
  label,
  value,
  sub,
  tone = 'muted',
  loading = false,
  children,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  loading?: boolean
  children?: ReactNode
}) {
  const toneText =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'crit'
          ? 'text-crit'
          : 'text-fg'

  return (
    <div className="panel flex min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] tracking-wide text-fg-faint uppercase">
        <span className="text-fg-faint">{icon}</span>
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <div className={cn('tnum text-2xl leading-7 font-semibold', toneText)}>{value}</div>
      )}
      {loading ? (
        <Skeleton className="h-3 w-20" />
      ) : sub ? (
        <div className="truncate text-[11px] text-fg-faint">{sub}</div>
      ) : null}
      {children}
    </div>
  )
}

export function KpiRow({
  summary,
  traffic,
  loading,
}: {
  summary: SummaryResponse | undefined
  /** 流量口径由前端统一（只有用量也算不限流量），不使用 summary 里的两个流量字段。 */
  traffic: TrafficRollup
  loading: boolean
}) {
  const offline = summary ? summary.instances_total - summary.instances_online : undefined
  const onlineTone: Tone = !summary
    ? 'muted'
    : summary.instances_total === 0
      ? 'muted'
      : summary.instances_online === summary.instances_total
        ? 'ok'
        : 'warn'
  const providerTone: Tone = !summary
    ? 'muted'
    : summary.providers_ok === summary.providers_total
      ? 'ok'
      : summary.providers_ok === 0
        ? 'crit'
        : 'warn'

  const trafficPercent = traffic.quotaPercent

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Tile
        icon={<Server size={12} />}
        label="实例总数"
        loading={loading}
        value={formatCount(summary?.instances_total)}
        sub={summary ? `覆盖 ${formatCount(summary.providers_total)} 家供应商` : undefined}
      />
      <Tile
        icon={<Gauge size={12} />}
        label="在线实例"
        loading={loading}
        tone={onlineTone}
        value={
          summary ? (
            <>
              {formatCount(summary.instances_online)}
              <span className="text-base text-fg-faint"> / {formatCount(summary.instances_total)}</span>
            </>
          ) : (
            EMPTY
          )
        }
        sub={offline !== undefined ? (offline > 0 ? `${offline} 台不在线` : '全部在线') : undefined}
      />
      <Tile
        icon={<Layers size={12} />}
        label="采集正常"
        loading={loading}
        tone={providerTone}
        value={
          summary ? (
            <>
              {formatCount(summary.providers_ok)}
              <span className="text-base text-fg-faint"> / {formatCount(summary.providers_total)}</span>
            </>
          ) : (
            EMPTY
          )
        }
        sub="最近一次采集成功的供应商"
      />
      <Tile
        icon={<Share2 size={12} />}
        label="固定配额流量"
        loading={loading}
        value={
          traffic.quota > 0 ? (
            <span className="block truncate text-lg xl:text-xl">
              {formatBytes(traffic.quotaUsedBytes)}
              <span className="text-sm text-fg-faint">
                {' / '}
                {formatBytes(traffic.quotaTotalBytes)}
              </span>
            </span>
          ) : (
            EMPTY
          )
        }
        sub={
          trafficPercent !== undefined
            ? `已用 ${formatPercent(trafficPercent)}（${formatCount(traffic.quota)} 台有配额）`
            : '暂无固定配额实例'
        }
      >
        {!loading && trafficPercent !== undefined ? (
          <Meter
            percent={trafficPercent}
            tone={trafficTone(trafficPercent)}
            label="总流量配额使用率"
          />
        ) : null}
      </Tile>
      <Tile
        icon={<InfinityIcon size={12} />}
        label="无限流量"
        loading={loading}
        value={formatCount(traffic.unlimited)}
        sub={
          traffic.unknown > 0
            ? `不限月配额；另有 ${traffic.unknown} 台无流量数据`
            : '不限月配额，按带宽或用量计费'
        }
      />
    </div>
  )
}
