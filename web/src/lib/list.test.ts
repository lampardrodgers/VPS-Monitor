import { describe, expect, it } from 'vitest'

import type { InstanceObservation } from '@/api/types'
import { toInstanceViews } from '@/lib/instance'
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  applyInstanceOrder,
  filterInstances,
  paginate,
  reorderInstanceIds,
  sortInstances,
  toggleSort,
} from '@/lib/list'

const NOW = Date.parse('2026-08-10T03:35:00Z')

function make(
  provider: string,
  key: string,
  name: string,
  status: string | null,
  metrics: InstanceObservation['metrics'] = {},
): InstanceObservation {
  return {
    provider,
    instance_key: key,
    display_name: name,
    observed_at: '2026-08-10T03:30:00+00:00',
    status,
    metrics,
    quota: {},
    metadata: {},
  }
}

const views = toInstanceViews(
  [
    make('panstar', '1', 'alpha', 'READY', { cpu_percent: 12 }),
    make('dedione', '2', 'bravo', 'stopped', { cpu_percent: 80 }),
    make('panstar', '3', 'charlie', null),
    make('aliyun_swas', '4', 'delta', 'Running', { cpu_percent: 3 }),
  ],
  NOW,
)

describe('filterInstances', () => {
  it('默认不过滤', () => {
    expect(filterInstances(views, DEFAULT_FILTERS)).toHaveLength(4)
  })

  it('按供应商过滤', () => {
    expect(filterInstances(views, { ...DEFAULT_FILTERS, provider: 'panstar' })).toHaveLength(2)
  })

  it('按归一后的状态分组过滤，兼容大小写差异', () => {
    const online = filterInstances(views, { ...DEFAULT_FILTERS, status: 'online' })
    expect(online.map((view) => view.name)).toEqual(['alpha', 'delta'])
    expect(filterInstances(views, { ...DEFAULT_FILTERS, status: 'unknown' })).toHaveLength(1)
  })

  it('搜索名称、实例键和供应商', () => {
    expect(filterInstances(views, { ...DEFAULT_FILTERS, search: 'BRA' })).toHaveLength(1)
    expect(filterInstances(views, { ...DEFAULT_FILTERS, search: '3' })).toHaveLength(1)
    expect(filterInstances(views, { ...DEFAULT_FILTERS, search: '阿里云' })).toHaveLength(1)
    expect(filterInstances(views, { ...DEFAULT_FILTERS, search: 'nope' })).toHaveLength(0)
  })

  it('设置备注名后仍可用供应商原名搜索', () => {
    const renamed = views.map((view) =>
      view.originalName === 'alpha' ? { ...view, name: '香港备用机' } : view,
    )
    expect(filterInstances(renamed, { ...DEFAULT_FILTERS, search: '香港备用机' })).toHaveLength(1)
    expect(filterInstances(renamed, { ...DEFAULT_FILTERS, search: 'alpha' })).toHaveLength(1)
  })
})

describe('sortInstances', () => {
  it('按名称升序', () => {
    const sorted = sortInstances(views, DEFAULT_SORT)
    expect(sorted.map((view) => view.name)).toEqual(['alpha', 'bravo', 'charlie', 'delta'])
  })

  it('数值排序时缺失值始终沉底', () => {
    const desc = sortInstances(views, { key: 'cpu', direction: 'desc' })
    expect(desc.map((view) => view.name)).toEqual(['bravo', 'alpha', 'delta', 'charlie'])

    const asc = sortInstances(views, { key: 'cpu', direction: 'asc' })
    expect(asc.map((view) => view.name)).toEqual(['delta', 'alpha', 'bravo', 'charlie'])
  })

  it('不修改原数组', () => {
    const before = views.map((view) => view.name)
    sortInstances(views, { key: 'cpu', direction: 'desc' })
    expect(views.map((view) => view.name)).toEqual(before)
  })
})

describe('toggleSort', () => {
  it('切换列时数值列默认降序、文本列默认升序', () => {
    expect(toggleSort({ key: 'name', direction: 'asc' }, 'cpu')).toEqual({
      key: 'cpu',
      direction: 'desc',
    })
    expect(toggleSort({ key: 'cpu', direction: 'desc' }, 'name')).toEqual({
      key: 'name',
      direction: 'asc',
    })
  })

  it('同一列点击时反转方向', () => {
    expect(toggleSort({ key: 'cpu', direction: 'desc' }, 'cpu')).toEqual({
      key: 'cpu',
      direction: 'asc',
    })
  })

  it('手动排序状态点击列时恢复该列默认方向', () => {
    expect(toggleSort(null, 'name')).toEqual({ key: 'name', direction: 'asc' })
    expect(toggleSort(null, 'cpu')).toEqual({ key: 'cpu', direction: 'desc' })
  })
})

describe('manual instance order', () => {
  it('应用已保存顺序并把新实例追加到末尾', () => {
    const ordered = applyInstanceOrder(views, [views[2]!.id, views[0]!.id])
    expect(ordered.map((view) => view.name)).toEqual(['charlie', 'alpha', 'bravo', 'delta'])
  })

  it('支持移动到目标前后并清理重复 ID', () => {
    expect(reorderInstanceIds(['a', 'b', 'c', 'b'], 'a', 'c', 'after')).toEqual([
      'b',
      'c',
      'a',
    ])
    expect(reorderInstanceIds(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual([
      'c',
      'a',
      'b',
    ])
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 23 }, (_, index) => index)

  it('计算页码范围', () => {
    const page = paginate(items, 2, 10)
    expect(page.items).toHaveLength(10)
    expect(page.from).toBe(11)
    expect(page.to).toBe(20)
    expect(page.pageCount).toBe(3)
  })

  it('页码越界时收敛到有效范围', () => {
    expect(paginate(items, 99, 10).page).toBe(3)
    expect(paginate(items, 0, 10).page).toBe(1)
  })

  it('空列表返回第 1 页', () => {
    const page = paginate([], 1, 10)
    expect(page).toMatchObject({ page: 1, pageCount: 1, total: 0, from: 0, to: 0 })
  })
})
