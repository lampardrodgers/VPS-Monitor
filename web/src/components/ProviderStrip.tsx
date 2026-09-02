import { ChevronDown, ChevronRight, CircleAlert, CircleCheck } from 'lucide-react'
import { useState } from 'react'

import type { ProviderStatus } from '@/api/types'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { EMPTY, formatDateTime, formatRelative, parseTimestamp } from '@/lib/format'
import { providerColor, providerMeta } from '@/lib/providers'
import { isStale } from '@/lib/status'

function ProviderCard({
  item,
  now,
  active,
  onSelect,
}: {
  item: ProviderStatus
  now: number
  active: boolean
  onSelect: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = providerMeta(item.provider)
  const collectedAt = parseTimestamp(item.last_collected_at)
  const stale = isStale(collectedAt, now)

  return (
    <div
      className={cn(
        'panel flex min-w-0 flex-col gap-2 p-3 transition-colors',
        active ? 'border-accent/60 bg-panel-soft' : 'hover:border-line-strong',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onSelect}
          title={active ? '取消筛选' : `只看 ${meta.label} 的实例`}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rotate-45"
            style={{ backgroundColor: providerColor(item.provider) }}
          />
          <span className="truncate text-[13px] font-medium text-fg">{meta.label}</span>
        </button>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 text-[11px]',
            item.ok ? 'text-ok' : 'text-crit',
          )}
        >
          {item.ok ? <CircleCheck size={12} /> : <CircleAlert size={12} />}
          {item.ok ? '正常' : '采集失败'}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-2 text-[11px] text-fg-faint">
        <span className="tabnum">
          <span className="text-base font-semibold text-fg">{item.instance_count}</span> 台实例
        </span>
        <span
          className={cn('tabnum', stale && 'text-warn')}
          title={`最近采集：${formatDateTime(item.last_collected_at)}`}
        >
          {item.last_collected_at ? formatRelative(item.last_collected_at, now) : EMPTY}
        </span>
      </div>

      {item.last_error ? (
        <div className="rounded border border-crit/30 bg-crit-soft px-2 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="flex w-full items-start gap-1 text-left text-[11px] text-crit"
          >
            {expanded ? (
              <ChevronDown size={12} className="mt-0.5 shrink-0" />
            ) : (
              <ChevronRight size={12} className="mt-0.5 shrink-0" />
            )}
            <span className={cn('min-w-0 break-words', !expanded && 'line-clamp-1')}>
              {item.last_error}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function ProviderStrip({
  items,
  loading,
  now,
  activeProvider,
  onSelectProvider,
}: {
  items: ProviderStatus[] | undefined
  loading: boolean
  now: number
  activeProvider: string | 'all'
  onSelectProvider: (provider: string | 'all') => void
}) {
  if (loading) {
    return (
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="panel space-y-2 p-3">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    )
  }

  if (!items || items.length === 0) {
    return (
      <div className="panel px-4 py-6 text-center text-xs text-fg-faint">
        还没有任何采集记录。启动采集服务后，这里会自动出现新的供应商。
      </div>
    )
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <ProviderCard
          key={item.provider}
          item={item}
          now={now}
          active={activeProvider === item.provider}
          onSelect={() =>
            onSelectProvider(activeProvider === item.provider ? 'all' : item.provider)
          }
        />
      ))}
    </div>
  )
}
