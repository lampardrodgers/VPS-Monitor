import { GripVertical } from 'lucide-react'

import { CpuCell, StaleBadge, TrafficCell, UsageCell } from '@/components/cells'
import { ProviderTag, StatusPill } from '@/components/ui/Badge'
import { CountryFlag } from '@/components/ui/CountryFlag'
import { useInstanceReorder } from '@/hooks/useInstanceReorder'
import { cn } from '@/lib/cn'
import { formatDateTime, formatRelative } from '@/lib/format'
import type { InstanceView } from '@/lib/instance'
import type { DropPosition } from '@/lib/list'
import { providerColor } from '@/lib/providers'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] tracking-wide text-fg-faint uppercase">{label}</div>
      {children}
    </div>
  )
}

/** 移动端与卡片视图共用。信息与表格一致，只是纵向排列。 */
export function InstanceCards({
  views,
  selectedId,
  onSelect,
  onReorder,
  now,
}: {
  views: InstanceView[]
  selectedId: string | null
  onSelect: (view: InstanceView) => void
  onReorder: (activeId: string, targetId: string, position: DropPosition) => void
  now: number
}) {
  const { draggingId, dropTarget, pointerHandlers } = useInstanceReorder(onReorder)

  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {views.map((view, index) => {
        const targeted = dropTarget?.id === view.id
        return (
          <article
            key={view.id}
            data-reorder-id={view.id}
            data-reorder-layout="cards"
            className={cn(
              'panel relative flex flex-col gap-3 p-3 text-left transition-colors',
              view.id === selectedId
                ? 'border-accent/60 bg-accent-soft'
                : 'hover:border-line-strong hover:bg-panel-hover',
              draggingId === view.id && 'opacity-50',
              targeted && 'ring-2 ring-accent/70',
            )}
          >
            <button
              type="button"
              aria-label={`查看 ${view.name}`}
              aria-pressed={view.id === selectedId}
              title="点击查看详情"
              onClick={() => onSelect(view)}
              className="absolute inset-0 z-0 cursor-pointer rounded-[inherit] text-left"
            />

            <div className="pointer-events-none relative z-10 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-1">
                  <button
                    type="button"
                    aria-label={`拖拽调整 ${view.name} 的顺序`}
                    title="拖拽调整顺序；键盘可用上下方向键"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => pointerHandlers.onPointerDown(event, view.id)}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'ArrowUp' && index > 0) {
                        event.preventDefault()
                        onReorder(view.id, views[index - 1]!.id, 'before')
                      }
                      if (event.key === 'ArrowDown' && index < views.length - 1) {
                        event.preventDefault()
                        onReorder(view.id, views[index + 1]!.id, 'after')
                      }
                    }}
                    className="pointer-events-auto -m-1 inline-flex touch-none cursor-grab items-center rounded p-1 text-fg-faint hover:bg-panel-hover hover:text-fg active:cursor-grabbing"
                  >
                    <GripVertical size={14} />
                  </button>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1">
                      <CountryFlag code={view.countryCode} />
                      <div className="truncate text-[13px] font-medium text-fg">{view.name}</div>
                    </div>
                    <ProviderTag label={view.provider.label} color={providerColor(view.provider.id)} />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill tone={view.status.tone} label={view.status.label} />
                  {view.stale ? <StaleBadge /> : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="CPU">
                  <CpuCell percent={view.cpuPercent} />
                </Field>
                <Field label="内存">
                  <UsageCell usage={view.memory} label="内存" />
                </Field>
                <Field label="磁盘">
                  <UsageCell usage={view.disk} label="磁盘" />
                </Field>
                <Field label="流量">
                  <TrafficCell traffic={view.traffic} now={now} />
                </Field>
              </div>

              <div
                className={cn('tabnum text-[10px]', view.stale ? 'text-warn' : 'text-fg-faint')}
                title={formatDateTime(view.observedAtRaw)}
              >
                更新于 {formatRelative(view.observedAtRaw, now)}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
