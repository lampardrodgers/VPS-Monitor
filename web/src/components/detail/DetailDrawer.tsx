import { CalendarClock, Check, Cpu, Flag, Globe2, MonitorCog, Package, Pencil, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ApiError, firstError } from '@/api/errors'
import { useInstance, useInstanceHistory } from '@/api/queries'
import type { InstanceRef } from '@/api/types'
import { HistoryCharts } from '@/components/detail/HistoryCharts'
import { ResourceGrid } from '@/components/detail/ResourceGrid'
import { TrafficCard } from '@/components/detail/TrafficCard'
import { StaleBadge } from '@/components/cells'
import { ProviderTag, StatusPill } from '@/components/ui/Badge'
import { ErrorState } from '@/components/ui/States'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { CountryFlag } from '@/components/ui/CountryFlag'
import { usePreferences } from '@/hooks/preferences'
import { cn } from '@/lib/cn'
import { daysUntil, EMPTY, formatBytes, formatDate, formatDateTime, formatRelative } from '@/lib/format'
import { toInstanceView, type InstanceView } from '@/lib/instance'
import { clearInstanceAlias, readInstanceAlias, writeInstanceAlias } from '@/lib/instanceName'
import {
  clearInstanceCountry,
  countryFlag,
  countryLabel,
  filterCountryOptions,
  readInstanceCountry,
  writeInstanceCountry,
} from '@/lib/country'
import { providerColor } from '@/lib/providers'
import { RANGE_OPTIONS, rangeOption, type RangeKey } from '@/lib/series'

function MetaItem({
  icon,
  label,
  value,
  tone,
  title,
}: {
  icon: ReactNode
  label: string
  value: string | undefined
  tone?: 'warn' | 'crit'
  title?: string
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="flex items-center gap-1 text-[10px] tracking-wide text-fg-faint uppercase">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          'truncate text-xs',
          tone === 'crit' ? 'text-crit' : tone === 'warn' ? 'text-warn' : 'text-fg-dim',
        )}
      >
        {value ?? EMPTY}
      </div>
    </div>
  )
}

function InstanceNameEditor({
  view,
  onChange,
}: {
  view: InstanceView
  onChange: () => void
}) {
  const hasAlias = view.name !== view.originalName
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(hasAlias ? view.name : '')

  useEffect(() => {
    setDraft(hasAlias ? view.name : '')
    setEditing(false)
  }, [hasAlias, view.id, view.name])

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <h2 className="truncate text-sm font-semibold text-fg" title={view.name}>
          {view.name}
        </h2>
        <button
          type="button"
          aria-label={hasAlias ? `修改 ${view.name} 的备注名` : `为 ${view.name} 设置备注名`}
          title={hasAlias ? '修改备注名' : '设置备注名'}
          onClick={() => setEditing(true)}
          className="shrink-0 rounded p-1 text-fg-faint hover:bg-panel-hover hover:text-fg"
        >
          <Pencil size={12} />
        </button>
      </div>
    )
  }

  return (
    <form
      className="flex min-w-0 items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        writeInstanceAlias(view.ref, draft)
        setEditing(false)
        onChange()
      }}
    >
      <input
        autoFocus
        aria-label="VPS 备注名"
        maxLength={80}
        value={draft}
        placeholder={view.originalName}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setDraft(hasAlias ? view.name : '')
            setEditing(false)
          }
        }}
        className="min-w-0 max-w-64 rounded border border-line-strong bg-panel px-2 py-1 text-sm font-semibold text-fg outline-none focus:border-accent/60"
      />
      <button
        type="submit"
        aria-label="保存备注名"
        title="保存备注名"
        className="shrink-0 rounded p-1 text-ok hover:bg-panel-hover"
      >
        <Check size={14} />
      </button>
      {hasAlias ? (
        <button
          type="button"
          aria-label="清除备注名"
          title="清除备注名并恢复原名"
          onClick={() => {
            clearInstanceAlias(view.ref)
            setEditing(false)
            onChange()
          }}
          className="shrink-0 rounded p-1 text-fg-faint hover:bg-panel-hover hover:text-crit"
        >
          <Trash2 size={13} />
        </button>
      ) : null}
    </form>
  )
}

function InstanceCountryEditor({
  view,
  onChange,
}: {
  view: InstanceView
  onChange: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const manualCountry = view.countrySource === 'manual' ? view.countryCode : undefined
  const countries = useMemo(() => filterCountryOptions(query), [query])

  useEffect(() => {
    if (!editing) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setEditing(false)
    }
    window.addEventListener('pointerdown', closeOnOutsideClick)
    return () => window.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [editing])

  return (
    <div ref={pickerRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={view.countryCode ? `修改国家或地区：${countryLabel(view.countryCode)}` : '选择国家或地区'}
        title={
          view.countryCode
            ? `${countryLabel(view.countryCode)}${view.countrySource === 'api' ? '（API）' : '（手动）'}，点击修改`
            : 'API 未提供国家或地区，点击选择'
        }
        onClick={() => {
          setQuery('')
          setEditing((current) => !current)
        }}
        className="inline-flex h-7 w-8 shrink-0 items-center justify-center rounded border border-line bg-panel text-base hover:bg-panel-hover"
      >
        {view.countryCode ? <CountryFlag code={view.countryCode} className="text-lg" /> : <Flag size={13} className="text-fg-faint" />}
      </button>

      {editing ? (
        <div className="absolute top-full left-0 z-30 mt-1 w-64 overflow-hidden rounded border border-line-strong bg-panel shadow-xl">
          <div className="border-b border-line p-2">
            <label className="flex items-center gap-1.5 rounded border border-line bg-panel-soft px-2 focus-within:border-accent/60">
              <Search size={13} className="shrink-0 text-fg-faint" />
              <input
                autoFocus
                aria-label="搜索国家或地区"
                value={query}
                placeholder="搜索中文、英文或代码"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setEditing(false)
                  }
                }}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-fg outline-none placeholder:text-fg-faint"
              />
            </label>
          </div>

          <div className="max-h-60 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => {
                clearInstanceCountry(view.ref)
                setEditing(false)
                onChange()
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-dim hover:bg-panel-hover"
            >
              <span className="w-6 text-center text-base">
                {view.apiCountryCode ? countryFlag(view.apiCountryCode) : '—'}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {view.apiCountryCode
                  ? `使用 API 默认：${countryLabel(view.apiCountryCode)}`
                  : '不设置国家或地区'}
              </span>
              {!manualCountry ? <Check size={12} className="text-ok" /> : null}
            </button>

            {countries.length > 0 ? (
              countries.map((country) => (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => {
                    writeInstanceCountry(view.ref, country.code)
                    setEditing(false)
                    onChange()
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-panel-hover"
                >
                  <span className="w-6 text-center text-base">{country.flag}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">{country.label}</span>
                  <span className="tnum text-[10px] text-fg-faint">{country.code}</span>
                  {manualCountry === country.code ? <Check size={12} className="text-ok" /> : null}
                </button>
              ))
            ) : (
              <p className="px-2 py-5 text-center text-xs text-fg-faint">没有匹配的国家或地区</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DetailBody({
  view,
  now,
  range,
  onRangeChange,
}: {
  view: InstanceView
  now: number
  range: RangeKey
  onRangeChange: (range: RangeKey) => void
}) {
  const option = rangeOption(range)
  const history = useInstanceHistory(view.ref, { hours: option.hours, limit: option.limit }, true)
  const historyError = firstError(history.error, history.failureReason)
  const expiryDays = daysUntil(view.meta.expiresAt, now)

  return (
    <div className="space-y-4 px-4 pt-4 pb-8">
      <div className="grid grid-cols-2 gap-3 border-b border-line pb-4 sm:grid-cols-3">
        <MetaItem icon={<Globe2 size={10} />} label="区域" value={view.meta.region} />
        <MetaItem icon={<MonitorCog size={10} />} label="系统" value={view.meta.os} />
        <MetaItem icon={<Package size={10} />} label="套餐" value={view.meta.plan} />
        <MetaItem
          icon={<Cpu size={10} />}
          label="配置"
          // 核数与带宽各家给的不全，有哪项显示哪项，不要因为缺一项就整格留空。
          value={
            [
              view.meta.cpuCores !== undefined ? `${view.meta.cpuCores} 核` : null,
              view.meta.bandwidthMbps !== undefined ? `${view.meta.bandwidthMbps} Mbps` : null,
              view.memory.total !== undefined ? formatBytes(view.memory.total) : null,
            ]
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />
        <MetaItem
          icon={<CalendarClock size={10} />}
          label="到期时间"
          value={view.meta.expiresAt ? formatDate(view.meta.expiresAt) : undefined}
          tone={
            expiryDays === undefined ? undefined : expiryDays < 7 ? 'crit' : expiryDays < 30 ? 'warn' : undefined
          }
          title={
            expiryDays !== undefined
              ? `${expiryDays >= 0 ? `还有 ${expiryDays} 天到期` : `已过期 ${-expiryDays} 天`}`
              : undefined
          }
        />
        <MetaItem
          icon={<CalendarClock size={10} />}
          label="最后更新"
          value={formatRelative(view.observedAtRaw, now)}
          tone={view.stale ? 'warn' : undefined}
          title={formatDateTime(view.observedAtRaw)}
        />
      </div>

      <ResourceGrid view={view} />

      <TrafficCard traffic={view.traffic} now={now} instance={view.ref} />

      <div className="flex items-center justify-between gap-2 pt-1">
        <h3 className="text-[11px] font-semibold tracking-wide text-fg-dim uppercase">历史曲线</h3>
        <Segmented
          ariaLabel="历史时间范围"
          value={range}
          onChange={onRangeChange}
          options={RANGE_OPTIONS.map((option) => ({ value: option.key, label: option.label }))}
        />
      </div>

      {historyError !== undefined ? (
        <ErrorState
          error={historyError}
          onRetry={() => {
            void history.refetch()
          }}
          className="panel"
        />
      ) : (
        <HistoryCharts
          history={history.data}
          loading={history.isPending && historyError === undefined}
          range={range}
        />
      )}
    </div>
  )
}

export function DetailDrawer({
  selected,
  fallback,
  onClose,
  now,
  instanceNameRevision,
  onInstanceNameChange,
  instanceCountryRevision,
  onInstanceCountryChange,
}: {
  selected: InstanceRef
  fallback: InstanceView | undefined
  onClose: () => void
  now: number
  instanceNameRevision: number
  onInstanceNameChange: () => void
  instanceCountryRevision: number
  onInstanceCountryChange: () => void
}) {
  const { refetchInterval } = usePreferences()
  const [range, setRange] = useState<RangeKey>('24h')
  const panelRef = useRef<HTMLDivElement>(null)
  const instance = useInstance(selected, refetchInterval)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const view = useMemo(() => {
    const stored = instance.data ? toInstanceView(instance.data, now) : undefined
    const current = !fallback
      ? stored
      : !stored
        ? fallback
    // 列表里的阿里云数据可能来自实时接口；详情应优先展示时间更新的一份。
        : (fallback.observedAt ?? -Infinity) >= (stored.observedAt ?? -Infinity)
          ? fallback
          : stored
    if (!current) return undefined
    const manualCountry = readInstanceCountry(current.ref)
    return {
      ...current,
      name: readInstanceAlias(current.ref) ?? current.originalName,
      countryCode: manualCountry ?? current.apiCountryCode,
      countrySource: manualCountry
        ? ('manual' as const)
        : current.apiCountryCode
          ? ('api' as const)
          : undefined,
    }
  }, [instance.data, fallback, now, instanceNameRevision, instanceCountryRevision])

  const instanceError = firstError(instance.error, instance.failureReason)
  const notFound = instanceError instanceof ApiError && instanceError.isNotFound

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="关闭详情"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={view ? `${view.name} 实例详情` : '实例详情'}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[760px] flex-col overflow-y-auto border-l border-line bg-bg shadow-2xl outline-none"
      >
        <div className="sticky top-0 z-10 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {view ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <InstanceCountryEditor view={view} onChange={onInstanceCountryChange} />
                    <InstanceNameEditor view={view} onChange={onInstanceNameChange} />
                    <StatusPill tone={view.status.tone} label={view.status.label} />
                    {view.stale ? <StaleBadge /> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <ProviderTag
                      label={view.provider.label}
                      color={providerColor(view.provider.id)}
                    />
                    <span className="tnum text-[10px] text-fg-faint">{view.ref.instanceKey}</span>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="rounded border border-line bg-panel p-1.5 text-fg-dim transition-colors hover:bg-panel-hover hover:text-fg"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {notFound ? (
          <ErrorState error={instance.error} />
        ) : view ? (
          <DetailBody view={view} now={now} range={range} onRangeChange={setRange} />
        ) : instanceError !== undefined ? (
          <ErrorState
            error={instanceError}
            onRetry={() => {
              void instance.refetch()
            }}
          />
        ) : (
          <div className="space-y-3 p-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </div>
    </div>
  )
}
