import { ChevronDown, ChevronUp, ChevronsUpDown, GripVertical } from 'lucide-react'

import { CpuCell, StaleBadge, TrafficCell, UsageCell } from '@/components/cells'
import { ProviderTag, StatusPill } from '@/components/ui/Badge'
import { CountryFlag } from '@/components/ui/CountryFlag'
import { useInstanceReorder } from '@/hooks/useInstanceReorder'
import { cn } from '@/lib/cn'
import { formatDateTime, formatRelative } from '@/lib/format'
import type { InstanceView } from '@/lib/instance'
import type { DropPosition, SortKey, SortState } from '@/lib/list'
import { providerColor } from '@/lib/providers'

interface Column {
  key: SortKey
  label: string
  sortable: boolean
  className?: string
  align?: 'left' | 'right'
}

/**
 * 列定义集中在这里，新增指标列只要加一项 + 在行渲染里补一格。
 * 宽度用百分比且配合 `table-fixed`：名字列不再吞掉所有富余宽度，
 * 空间留给右侧真正承载信息的指标列。
 */
const COLUMNS: Column[] = [
  { key: 'name', label: '实例', sortable: true, className: 'w-[16%]' },
  { key: 'status', label: '状态', sortable: true, className: 'w-[10%]' },
  { key: 'cpu', label: 'CPU', sortable: true, className: 'w-[9%]' },
  { key: 'memory', label: '内存', sortable: true, className: 'w-[18%]' },
  { key: 'disk', label: '磁盘', sortable: true, className: 'w-[18%]' },
  { key: 'traffic', label: '流量', sortable: true, className: 'w-[20%]' },
  { key: 'observed', label: '更新', sortable: true, className: 'w-[9%]' },
]

function SortIcon({ state, column }: { state: SortState | null; column: SortKey }) {
  if (!state || state.key !== column) {
    return <ChevronsUpDown size={11} className="opacity-0 group-hover:opacity-60" />
  }
  return state.direction === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
}

export function InstanceTable({
  views,
  sort,
  onSort,
  selectedId,
  onSelect,
  onReorder,
  now,
}: {
  views: InstanceView[]
  sort: SortState | null
  onSort: (key: SortKey) => void
  selectedId: string | null
  onSelect: (view: InstanceView) => void
  onReorder: (activeId: string, targetId: string, position: DropPosition) => void
  now: number
}) {
  const { draggingId, dropTarget, pointerHandlers } = useInstanceReorder(onReorder)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] table-fixed border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-panel-soft">
            <th scope="col" className="w-8 px-1 py-2">
              <span className="sr-only">拖拽排序</span>
            </th>
            {COLUMNS.map((column) => {
              const active = sort?.key === column.key
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active && sort
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className={cn(
                    'px-3 py-2 text-[11px] font-medium tracking-wide text-fg-faint uppercase',
                    column.className,
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.key)}
                      className={cn(
                        'group inline-flex items-center gap-1 transition-colors hover:text-fg',
                        active && 'text-fg',
                      )}
                    >
                      {column.label}
                      <SortIcon state={sort} column={column.key} />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {views.map((view) => {
            const selected = view.id === selectedId
            const index = views.findIndex((item) => item.id === view.id)
            const targeted = dropTarget?.id === view.id
            return (
              <tr
                key={view.id}
                data-reorder-id={view.id}
                data-reorder-layout="table"
                tabIndex={0}
                aria-label={`${view.name}，${view.provider.label}，状态 ${view.status.label}`}
                aria-selected={selected}
                onClick={() => onSelect(view)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(view)
                  }
                }}
                className={cn(
                  'cursor-pointer border-b border-line/70 transition-colors last:border-b-0',
                  selected ? 'bg-accent-soft' : 'hover:bg-panel-hover',
                  draggingId === view.id && 'opacity-50',
                  targeted && dropTarget.position === 'before' && 'border-t-2 border-t-accent',
                  targeted && dropTarget.position === 'after' && 'border-b-2 border-b-accent',
                )}
              >
                <td className="w-8 px-1 py-2.5 text-center">
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
                    className="inline-flex touch-none cursor-grab items-center rounded p-1 text-fg-faint hover:bg-panel-hover hover:text-fg active:cursor-grabbing"
                  >
                    <GripVertical size={14} />
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1">
                      <CountryFlag code={view.countryCode} />
                      <span className="truncate text-[13px] font-medium text-fg" title={view.name}>
                        {view.name}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <ProviderTag
                        label={view.provider.label}
                        color={providerColor(view.provider.id)}
                        className="shrink-0"
                      />
                      <span
                        className="tnum min-w-0 truncate text-[10px] text-fg-faint"
                        title={`实例键：${view.ref.instanceKey}`}
                      >
                        {view.ref.instanceKey}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    <StatusPill
                      tone={view.status.tone}
                      label={view.status.label}
                      pulse={view.status.group === 'transitional'}
                      title={`供应商原始状态：${view.status.raw ?? '未返回'}`}
                    />
                    {view.stale ? <StaleBadge /> : null}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <CpuCell percent={view.cpuPercent} />
                </td>
                <td className="px-3 py-2.5">
                  <UsageCell usage={view.memory} label="内存" />
                </td>
                <td className="px-3 py-2.5">
                  <UsageCell usage={view.disk} label="磁盘" />
                </td>
                <td className="px-3 py-2.5">
                  <TrafficCell traffic={view.traffic} now={now} />
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn('tabnum text-xs whitespace-nowrap', view.stale ? 'text-warn' : 'text-fg-dim')}
                    title={formatDateTime(view.observedAtRaw)}
                  >
                    {formatRelative(view.observedAtRaw, now)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
