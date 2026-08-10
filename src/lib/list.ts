/**
 * 列表核心状态逻辑：筛选、排序、分页。纯函数，便于测试。
 */
import type { InstanceView } from '@/lib/instance'
import type { StatusInfo } from '@/lib/status'
import { trafficSortValue } from '@/lib/traffic'

export type SortKey =
  | 'name'
  | 'provider'
  | 'status'
  | 'cpu'
  | 'memory'
  | 'disk'
  | 'traffic'
  | 'observed'

export type SortDirection = 'asc' | 'desc'
export type DropPosition = 'before' | 'after'

export interface SortState {
  key: SortKey
  direction: SortDirection
}

export type StatusFilter = 'all' | StatusInfo['group']

export interface ListFilters {
  provider: string | 'all'
  status: StatusFilter
  search: string
}

export const DEFAULT_FILTERS: ListFilters = { provider: 'all', status: 'all', search: '' }
export const DEFAULT_SORT: SortState = { key: 'name', direction: 'asc' }
export const PAGE_SIZES = [10, 25, 50, 100] as const

function sortValue(view: InstanceView, key: SortKey): number | string | undefined {
  switch (key) {
    case 'name':
      return view.name.toLowerCase()
    case 'provider':
      return view.provider.label.toLowerCase()
    case 'status':
      return view.status.group
    case 'cpu':
      return view.cpuPercent
    case 'memory':
      return view.memory.percent
    case 'disk':
      return view.disk.percent
    case 'traffic':
      return trafficSortValue(view.traffic)
    case 'observed':
      return view.observedAt
    default:
      return undefined
  }
}

/** 无数据的实例始终排在最后，不因为“缺失=0”而抢占前排。 */
function compare(a: number | string | undefined, b: number | string | undefined): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  if (typeof a === 'string' || typeof b === 'string') {
    return String(a).localeCompare(String(b), 'zh-Hans-CN')
  }
  return a - b
}

export function sortInstances(views: readonly InstanceView[], sort: SortState): InstanceView[] {
  const factor = sort.direction === 'asc' ? 1 : -1
  return [...views].sort((left, right) => {
    const primary = compare(sortValue(left, sort.key), sortValue(right, sort.key))
    if (primary !== 0) {
      // 缺失值不参与方向翻转，永远沉底。
      const leftMissing = sortValue(left, sort.key) === undefined
      const rightMissing = sortValue(right, sort.key) === undefined
      if (leftMissing !== rightMissing) return primary
      return primary * factor
    }
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

/** 按用户保存的实例 ID 顺序排列；新发现或未保存的实例保持当前相对顺序并追加。 */
export function applyInstanceOrder(
  views: readonly InstanceView[],
  order: readonly string[],
): InstanceView[] {
  const rank = new Map(order.map((id, index) => [id, index]))
  return views
    .map((view, index) => ({ view, index, rank: rank.get(view.id) }))
    .sort((left, right) => {
      if (left.rank !== undefined && right.rank !== undefined) return left.rank - right.rank
      if (left.rank !== undefined) return -1
      if (right.rank !== undefined) return 1
      return left.index - right.index
    })
    .map((item) => item.view)
}

/** 把一个实例移动到目标实例之前或之后，同时清理重复 ID。 */
export function reorderInstanceIds(
  ids: readonly string[],
  activeId: string,
  targetId: string,
  position: DropPosition,
): string[] {
  const unique = [...new Set(ids)]
  if (activeId === targetId || !unique.includes(activeId) || !unique.includes(targetId)) {
    return unique
  }
  const next = unique.filter((id) => id !== activeId)
  const targetIndex = next.indexOf(targetId)
  next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, activeId)
  return next
}

/**
 * 客户端补充筛选：状态按归一分组匹配（供应商原始状态大小写、措辞都不同），
 * 供应商与关键字已经在服务端过滤过，这里再过一遍保证前后一致。
 */
export function filterInstances(
  views: readonly InstanceView[],
  filters: ListFilters,
): InstanceView[] {
  const needle = filters.search.trim().toLowerCase()
  return views.filter((view) => {
    if (filters.provider !== 'all' && view.provider.id !== filters.provider) return false
    if (filters.status !== 'all' && view.status.group !== filters.status) return false
    if (needle !== '') {
      const haystack = `${view.name} ${view.originalName} ${view.ref.instanceKey} ${view.provider.label} ${view.provider.id}`
      if (!haystack.toLowerCase().includes(needle)) return false
    }
    return true
  })
}

export interface Page<T> {
  items: T[]
  page: number
  pageCount: number
  total: number
  from: number
  to: number
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const start = (current - 1) * pageSize
  const slice = items.slice(start, start + pageSize)
  return {
    items: slice,
    page: current,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
  }
}

export function toggleSort(current: SortState | null, key: SortKey): SortState {
  if (!current || current.key !== key) {
    // 文本列默认升序，数值列默认降序（先看最忙的机器）。
    const numeric = key !== 'name' && key !== 'provider' && key !== 'status'
    return { key, direction: numeric ? 'desc' : 'asc' }
  }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}
