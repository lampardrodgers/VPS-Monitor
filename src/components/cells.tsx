import { Clock, Infinity as InfinityIcon, RotateCw } from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Meter } from '@/components/ui/Meter'
import { cn } from '@/lib/cn'
import {
  EMPTY,
  formatBytes,
  formatDateTime,
  formatDayClock,
  formatPercent,
  formatRelative,
  parseTimestamp,
} from '@/lib/format'
import type { Usage } from '@/lib/instance'
import { usageTone } from '@/lib/status'
import type { TrafficModel } from '@/lib/traffic'

/** CPU：只有百分比。缺失时显示“—”，不显示 0%。 */
export function CpuCell({ percent }: { percent: number | undefined }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={cn('tnum text-xs', percent === undefined ? 'text-fg-faint' : 'text-fg')}>
        {formatPercent(percent)}
      </span>
      <Meter percent={percent} tone={usageTone(percent)} label="CPU 使用率" height="h-1" />
    </div>
  )
}

/** 内存 / 磁盘：已用 / 总量 + 百分比条。 */
export function UsageCell({ usage, label }: { usage: Usage; label: string }) {
  const hasAny = usage.used !== undefined || usage.total !== undefined
  return (
    <div className="flex flex-col gap-1">
      <span className="tnum text-xs whitespace-nowrap">
        {hasAny ? (
          <>
            <span className={usage.used === undefined ? 'text-fg-faint' : 'text-fg'}>
              {formatBytes(usage.used)}
            </span>
            <span className="text-fg-faint"> / {formatBytes(usage.total)}</span>
          </>
        ) : (
          <span className="text-fg-faint">{EMPTY}</span>
        )}
      </span>
      <Meter
        percent={usage.percent}
        tone={usageTone(usage.percent)}
        label={`${label}使用率`}
        height="h-1"
        showValue
      />
    </div>
  )
}

/** 流量重置时间：只有部分供应商返回（如搬瓦工），没有就不占位。 */
function ResetHint({ value, now }: { value: string | undefined; now: number }) {
  const ms = parseTimestamp(value)
  if (ms === undefined) return null
  return (
    <span
      className="tabnum flex items-center gap-1 whitespace-nowrap text-[10px] text-fg-faint"
      title={`下次流量重置：${formatDateTime(ms)}（${formatRelative(ms, now)}）`}
    >
      <RotateCw size={9} aria-hidden="true" />
      重置 {formatDayClock(ms)}
    </span>
  )
}

export function TrafficCell({ traffic, now }: { traffic: TrafficModel; now: number }) {
  if (traffic.kind === 'none') {
    return <span className="text-xs text-fg-faint" title="供应商未返回流量数据">{EMPTY}</span>
  }

  if (traffic.kind === 'unlimited') {
    const title =
      traffic.source === 'declared'
        ? '供应商声明为不限流量（按带宽计费）'
        : '供应商只返回已用量、没有配额上限，按不限流量处理'
    // 有真实用量就把用量显示出来，标签只说明“没有配额上限”。
    return (
      <div className="flex flex-col items-start gap-1">
        {traffic.used !== undefined ? (
          <span className="tnum text-xs text-fg">{formatBytes(traffic.used)}</span>
        ) : null}
        <Badge tone="muted" icon={<InfinityIcon size={11} />} title={title}>
          无限流量
        </Badge>
        <ResetHint value={traffic.resetAt} now={now} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="tnum text-xs whitespace-nowrap">
        <span className="text-fg">{formatBytes(traffic.used)}</span>
        <span className="text-fg-faint"> / {formatBytes(traffic.total)}</span>
      </span>
      <Meter
        percent={traffic.percent}
        tone={traffic.tone}
        label="流量配额使用率"
        height="h-1"
        showValue
      />
      <ResetHint value={traffic.resetAt} now={now} />
    </div>
  )
}

export function StaleBadge({ title }: { title?: string }) {
  return (
    <Badge tone="warn" icon={<Clock size={10} />} title={title ?? '超过 10 分钟没有新的采集数据'}>
      数据陈旧
    </Badge>
  )
}
