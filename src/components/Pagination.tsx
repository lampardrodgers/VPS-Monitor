import { ChevronLeft, ChevronRight } from 'lucide-react'

import { PAGE_SIZES } from '@/lib/list'

export function Pagination({
  page,
  pageCount,
  from,
  to,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageCount: number
  from: number
  to: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2">
      <span className="tabnum text-[11px] text-fg-faint">
        显示 {from}–{to}，共 {total} 台
      </span>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-fg-faint">
          每页
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="tabnum rounded border border-line bg-panel px-1.5 py-1 text-[11px] text-fg-dim outline-none hover:bg-panel-hover"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="上一页"
            className="rounded border border-line bg-panel p-1 text-fg-dim transition-colors hover:bg-panel-hover disabled:opacity-40"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="tnum px-1 text-[11px] text-fg-dim">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
            aria-label="下一页"
            className="rounded border border-line bg-panel p-1 text-fg-dim transition-colors hover:bg-panel-hover disabled:opacity-40"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
