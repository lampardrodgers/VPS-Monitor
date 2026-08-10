import { LayoutGrid, Rows3, Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Segmented } from '@/components/ui/Segmented'
import type { ViewMode } from '@/hooks/preferences'
import { cn } from '@/lib/cn'
import type { ListFilters, StatusFilter } from '@/lib/list'
import { providerMeta } from '@/lib/providers'
import { STATUS_GROUP_LABEL } from '@/lib/status'

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'online', label: STATUS_GROUP_LABEL.online },
  { value: 'offline', label: STATUS_GROUP_LABEL.offline },
  { value: 'transitional', label: STATUS_GROUP_LABEL.transitional },
  { value: 'unknown', label: STATUS_GROUP_LABEL.unknown },
]

const selectClass =
  'rounded border border-line bg-panel px-2 py-1.5 text-xs text-fg-dim outline-none transition-colors hover:bg-panel-hover focus:text-fg'

export function FilterBar({
  filters,
  onChange,
  providers,
  viewMode,
  onViewModeChange,
  matched,
  total,
}: {
  filters: ListFilters
  onChange: (next: ListFilters) => void
  providers: string[]
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  matched: number
  total: number
}) {
  const searchRef = useRef<HTMLInputElement>(null)

  // `/` 聚焦搜索，Esc 清空，符合控制台类工具的肌肉记忆。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full min-w-0 sm:w-auto sm:max-w-xs sm:flex-1">
        <Search
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint"
        />
        <input
          ref={searchRef}
          type="search"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onChange({ ...filters, search: '' })
          }}
          placeholder="搜索实例名称或标识（/）"
          aria-label="搜索实例"
          className="w-full rounded border border-line bg-panel py-1.5 pr-7 pl-7 text-xs text-fg placeholder:text-fg-faint focus:border-line-strong focus:outline-none"
        />
        {filters.search ? (
          <button
            type="button"
            onClick={() => onChange({ ...filters, search: '' })}
            aria-label="清除搜索"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-fg-faint hover:text-fg"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>

      <select
        value={filters.provider}
        onChange={(event) => onChange({ ...filters, provider: event.target.value })}
        aria-label="按供应商筛选"
        className={selectClass}
      >
        <option value="all">全部供应商</option>
        {providers.map((provider) => (
          <option key={provider} value={provider}>
            {providerMeta(provider).label}
          </option>
        ))}
      </select>

      <select
        value={filters.status}
        onChange={(event) => onChange({ ...filters, status: event.target.value as StatusFilter })}
        aria-label="按状态筛选"
        className={selectClass}
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <span className={cn('tnum text-[11px] text-fg-faint', matched !== total && 'text-fg-dim')}>
        {matched} / {total}
      </span>

      <Segmented
        className="ml-auto"
        ariaLabel="列表视图"
        value={viewMode}
        onChange={onViewModeChange}
        options={[
          { value: 'table', label: <Rows3 size={13} />, title: '表格视图' },
          { value: 'cards', label: <LayoutGrid size={13} />, title: '卡片视图' },
        ]}
      />
    </div>
  )
}
