import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { firstError, isTunnelDown } from '@/api/errors'
import { useInstances, useLiveAliyun, useProviders, useRefreshAll, useSummary } from '@/api/queries'
import { FilterBar } from '@/components/FilterBar'
import { InstanceCards } from '@/components/InstanceCards'
import { InstanceTable } from '@/components/InstanceTable'
import { KpiRow } from '@/components/KpiRow'
import { Pagination } from '@/components/Pagination'
import { ProviderStrip } from '@/components/ProviderStrip'
import { TopBar } from '@/components/TopBar'
import { DetailDrawer } from '@/components/detail/DetailDrawer'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { EmptyState, ErrorState, NoResultState } from '@/components/ui/States'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { usePreferences } from '@/hooks/preferences'
import { useNow } from '@/hooks/useNow'
import { useSelectedInstance } from '@/hooks/useSelectedInstance'
import { mergeLiveInstances, rollupTraffic, toInstanceViews } from '@/lib/instance'
import { readInstanceAlias } from '@/lib/instanceName'
import { readInstanceCountry } from '@/lib/country'
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  applyInstanceOrder,
  filterInstances,
  paginate,
  reorderInstanceIds,
  sortInstances,
  toggleSort,
  type DropPosition,
  type ListFilters,
  type SortKey,
  type SortState,
} from '@/lib/list'
import { readStoredStringArray, writeStoredStringArray } from '@/lib/storage'
import { instanceId } from '@/api/types'

const INSTANCE_ORDER_KEY = 'instanceOrder'

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-[11px] font-semibold tracking-[0.12em] text-fg-dim uppercase">
        {children}
      </h2>
      {hint ? <span className="text-[11px] text-fg-faint">{hint}</span> : null}
    </div>
  )
}

export default function App() {
  const now = useNow()
  const { refetchInterval, viewMode, setViewMode, pageSize, setPageSize } = usePreferences()

  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS)
  const [manualOrder, setManualOrder] = useState<string[]>(
    () => readStoredStringArray(INSTANCE_ORDER_KEY) ?? [],
  )
  const [sort, setSort] = useState<SortState | null>(() =>
    (readStoredStringArray(INSTANCE_ORDER_KEY)?.length ?? 0) > 0 ? null : DEFAULT_SORT,
  )
  const [page, setPage] = useState(1)
  const [providersOpen, setProvidersOpen] = useState(false)
  const [instanceNameRevision, setInstanceNameRevision] = useState(0)
  const [instanceCountryRevision, setInstanceCountryRevision] = useState(0)

  const { selected, select } = useSelectedInstance()

  const summary = useSummary(refetchInterval)
  const providers = useProviders(refetchInterval)
  // 一次取回全部实例，筛选 / 排序 / 分页都在客户端做：切条件不再重新请求，
  // 顶部统计也能和表格用同一份数据，不会出现两边对不上的情况。
  const instances = useInstances({}, refetchInterval)
  const liveAliyun = useLiveAliyun(refetchInterval)

  // 重试期间 error 还是 null，必须同时看 failureReason，否则隧道断开时会一直转骨架屏。
  const summaryError = firstError(summary.error, summary.failureReason)
  const providersError = firstError(providers.error, providers.failureReason)
  const instancesError = firstError(instances.error, instances.failureReason)

  const observations = useMemo(
    () => mergeLiveInstances(instances.data?.items ?? [], liveAliyun.data),
    [instances.data, liveAliyun.data],
  )
  const views = useMemo(
    () =>
      toInstanceViews(observations, now).map((view) => {
        const manualCountry = readInstanceCountry(view.ref)
        return {
          ...view,
          name: readInstanceAlias(view.ref) ?? view.originalName,
          countryCode: manualCountry ?? view.apiCountryCode,
          countrySource: manualCountry ? ('manual' as const) : view.apiCountryCode ? ('api' as const) : undefined,
        }
      }),
    // instanceNameRevision 用于保存备注名后主动重读本地存储。
    [observations, now, instanceNameRevision, instanceCountryRevision],
  )
  const traffic = useMemo(() => rollupTraffic(views), [views])
  const displaySummary = useMemo(() => {
    if (!summary.data || !instances.data) return summary.data
    return {
      ...summary.data,
      instances_total: views.length,
      instances_online: views.filter((view) => view.status.group === 'online').length,
    }
  }, [summary.data, instances.data, views])
  const filtered = useMemo(() => filterInstances(views, filters), [views, filters])
  const sorted = useMemo(
    () => (sort ? sortInstances(filtered, sort) : applyInstanceOrder(filtered, manualOrder)),
    [filtered, sort, manualOrder],
  )
  const pageData = useMemo(() => paginate(sorted, page, pageSize), [sorted, page, pageSize])

  useEffect(() => {
    setPage(1)
  }, [filters, pageSize])

  const closeProviders = useCallback(() => setProvidersOpen(false), [])

  useEffect(() => {
    if (!providersOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeProviders()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [providersOpen, closeProviders])

  const providerSummary = useMemo(() => {
    const items = providers.data?.items
    if (!items) return undefined
    const ok = items.filter((item) => item.ok).length
    return { total: items.length, ok, failed: items.length - ok }
  }, [providers.data])

  const providerIds = useMemo(() => {
    const ids = new Set<string>(providers.data?.items.map((item) => item.provider) ?? [])
    for (const view of views) ids.add(view.provider.id)
    return [...ids].sort()
  }, [providers.data, views])

  const selectedView = useMemo(
    () => (selected ? views.find((view) => view.id === instanceId(selected)) : undefined),
    [selected, views],
  )

  const refreshAll = useRefreshAll()
  const tunnelDown = [summaryError, providersError, instancesError].some(isTunnelDown)
  // 一条数据都没有时只提示一次，不要在三个区块里重复同一句话。
  const disconnected = tunnelDown && !summary.data && !providers.data && !instances.data

  const listError = instancesError !== undefined && !instances.data && views.length === 0
  const listLoading = instances.isPending && instancesError === undefined && views.length === 0

  const onSort = (key: SortKey) => setSort((current) => toggleSort(current, key))
  const onReorder = useCallback(
    (activeId: string, targetId: string, position: DropPosition) => {
      const base = sort ? sortInstances(views, sort) : applyInstanceOrder(views, manualOrder)
      const next = reorderInstanceIds(
        base.map((view) => view.id),
        activeId,
        targetId,
        position,
      )
      setManualOrder(next)
      writeStoredStringArray(INSTANCE_ORDER_KEY, next)
      setSort(null)
    },
    [sort, views, manualOrder],
  )

  return (
    <div className="min-h-screen">
      <TopBar
        now={now}
        providers={providerSummary}
        providersOpen={providersOpen}
        onToggleProviders={() => setProvidersOpen((open) => !open)}
        onCloseProviders={closeProviders}
        providerPanel={
          providersError !== undefined && !providers.data ? (
            <ErrorState
              error={providersError}
              onRetry={() => {
                void providers.refetch()
              }}
            />
          ) : (
            <ProviderStrip
              items={providers.data?.items}
              loading={providers.isPending}
              now={now}
              activeProvider={filters.provider}
              onSelectProvider={(provider) => {
                setFilters({ ...filters, provider })
                setProvidersOpen(false)
              }}
            />
          )
        }
      />

      {tunnelDown && !disconnected ? (
        <div className="border-b border-crit/40 bg-crit-soft">
          <div className="mx-auto flex max-w-[1600px] items-start gap-2 px-4 py-2 text-xs text-crit lg:px-6">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <p>
              无法连接 API：SSH 隧道未连接或服务未启动。请执行
              <code className="tnum mx-1 rounded bg-panel px-1 py-0.5 text-[11px]">
                ssh -N -L 8787:127.0.0.1:18787 root@&lt;SERVER_IP&gt;
              </code>
              后重试；下方展示的是最后一次成功获取的数据。
            </p>
          </div>
        </div>
      ) : null}

      {disconnected ? (
        <main className="mx-auto max-w-3xl px-4 py-16 lg:px-6">
          <Panel>
            <ErrorState
              error={summaryError ?? instancesError ?? providersError}
              onRetry={() => {
                void refreshAll()
              }}
            />
            <p className="border-t border-line px-6 py-3 text-center text-[11px] text-fg-faint">
              隧道恢复后页面会自动重连，无需刷新浏览器。
            </p>
          </Panel>
        </main>
      ) : (
      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 lg:px-6">
        <section className="space-y-2">
          <SectionTitle hint="按供应商汇总的实时快照">总览</SectionTitle>
          {summaryError !== undefined && !summary.data ? (
            <Panel>
              <ErrorState
                error={summaryError}
                onRetry={() => {
                  void summary.refetch()
                }}
              />
            </Panel>
          ) : (
            <KpiRow summary={displaySummary} traffic={traffic} loading={summary.isPending} />
          )}
        </section>

        <Panel className="overflow-hidden">
          <PanelHeader
            title="实例"
            subtitle={
              instances.data
                ? `共 ${instances.data.total} 台${sort === null ? ' · 手动排序' : ''}`
                : undefined
            }
          />
          <div className="border-b border-line px-3 py-2">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              providers={providerIds}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              matched={sorted.length}
              total={views.length}
            />
          </div>

          {listLoading ? (
            <SkeletonRows rows={6} />
          ) : listError ? (
            <ErrorState
              error={instancesError}
              onRetry={() => {
                void instances.refetch()
              }}
            />
          ) : views.length === 0 ? (
            <EmptyState
              title="还没有任何实例数据"
              hint="采集服务写入第一条 observation 后，实例会自动出现在这里，无需修改前端配置。"
            />
          ) : sorted.length === 0 ? (
            <NoResultState onClear={() => setFilters(DEFAULT_FILTERS)} />
          ) : (
            <>
              <div className="hidden md:block">
                {viewMode === 'table' ? (
                  <InstanceTable
                    views={pageData.items}
                    sort={sort}
                    onSort={onSort}
                    selectedId={selected ? instanceId(selected) : null}
                    onSelect={(view) => select(view.ref)}
                    onReorder={onReorder}
                    now={now}
                  />
                ) : (
                  <InstanceCards
                    views={pageData.items}
                    selectedId={selected ? instanceId(selected) : null}
                    onSelect={(view) => select(view.ref)}
                    onReorder={onReorder}
                    now={now}
                  />
                )}
              </div>
              {/* 移动端固定使用卡片，密集表格在窄屏不可用。 */}
              <div className="md:hidden">
                <InstanceCards
                  views={pageData.items}
                  selectedId={selected ? instanceId(selected) : null}
                  onSelect={(view) => select(view.ref)}
                  onReorder={onReorder}
                  now={now}
                />
              </div>
              <Pagination
                page={pageData.page}
                pageCount={pageData.pageCount}
                from={pageData.from}
                to={pageData.to}
                total={pageData.total}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
        </Panel>

        <footer className="pb-6 text-center text-[10px] text-fg-faint">
          只读监控界面 · 不执行任何开关机或重装操作 · 数据来自本地 SSH 隧道
        </footer>
      </main>
      )}

      {selected ? (
        <DetailDrawer
          selected={selected}
          fallback={selectedView}
          onClose={() => select(null)}
          now={now}
          instanceNameRevision={instanceNameRevision}
          onInstanceNameChange={() => setInstanceNameRevision((current) => current + 1)}
          instanceCountryRevision={instanceCountryRevision}
          onInstanceCountryChange={() => setInstanceCountryRevision((current) => current + 1)}
        />
      ) : null}
    </div>
  )
}
