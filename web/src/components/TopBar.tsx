import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ChevronDown,
  Loader2,
  Moon,
  RefreshCw,
  Server,
  Sun,
  Terminal,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { apiBaseUrl } from '@/api/client'
import { ApiError, firstError } from '@/api/errors'
import { useHealth, useRefreshAll } from '@/api/queries'
import { StatusPill } from '@/components/ui/Badge'
import { RetentionControl } from '@/components/RetentionControl'
import { usePreferences, REFRESH_OPTIONS } from '@/hooks/preferences'
import { cn } from '@/lib/cn'
import { EMPTY, formatDateTime, formatRelative } from '@/lib/format'
import type { Tone } from '@/lib/status'

function healthState(
  isPending: boolean,
  error: unknown,
): { tone: Tone; label: string; title: string } {
  if (isPending) return { tone: 'muted', label: '连接中', title: '正在检测本地 API' }
  if (error instanceof ApiError) {
    if (error.isTunnelDown) {
      return { tone: 'crit', label: 'SSH 连接失败', title: '临时 SSH 建立失败或 API 未启动' }
    }
    if (error.isDatabaseDown) {
      return { tone: 'crit', label: '数据库异常', title: 'API 可达，但监控数据库不可用' }
    }
    return { tone: 'warn', label: 'API 异常', title: error.message }
  }
  if (error) return { tone: 'warn', label: 'API 异常', title: String(error) }
  return { tone: 'ok', label: 'API 已连接', title: `${apiBaseUrl} 可达` }
}

export interface ProviderSummary {
  total: number
  ok: number
  failed: number
}

export function TopBar({
  now,
  providers,
  providersOpen,
  onToggleProviders,
  onCloseProviders,
  providerPanel,
}: {
  now: number
  providers: ProviderSummary | undefined
  providersOpen: boolean
  onToggleProviders: () => void
  onCloseProviders: () => void
  /** 供应商详情内容，由页面注入；只在弹层展开时挂载，不占用正文空间。 */
  providerPanel: ReactNode
}) {
  const { theme, toggleTheme, refreshMs, setRefreshMs, refetchInterval } = usePreferences()
  const health = useHealth(refetchInterval)
  const refreshAll = useRefreshAll()
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const providerRef = useRef<HTMLDivElement>(null)

  // 点击弹层以外的任何位置都收起，行为和常规下拉菜单一致。
  useEffect(() => {
    if (!providersOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && providerRef.current?.contains(target)) return
      onCloseProviders()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [providersOpen, onCloseProviders])

  const isFetching = client.isFetching() > 0
  const healthError = firstError(health.error, health.failureReason)
  const state = healthState(health.isPending && healthError === undefined, healthError)
  const latest = health.data?.latest_observation_at ?? null

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshAll()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded border border-line bg-panel text-accent">
            <Activity size={15} strokeWidth={2.2} />
          </span>
          <div className="leading-tight">
            <h1 className="text-[13px] font-semibold tracking-[0.14em] text-fg uppercase">
              VPS 监控中心
            </h1>
            <p className="tnum flex items-center gap-1 text-[10px] text-fg-faint">
              <Terminal size={9} />
              {apiBaseUrl}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusPill
            tone={state.tone}
            label={state.label}
            title={state.title}
            pulse={state.tone === 'ok' && isFetching}
          />
          <span
            className="hidden text-[11px] text-fg-faint sm:inline"
            title={latest ? `最近采集：${formatDateTime(latest)}` : '暂无采集记录'}
          >
            数据 <span className="tabnum text-fg-dim">{latest ? formatRelative(latest, now) : EMPTY}</span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative" ref={providerRef}>
            <button
              type="button"
              onClick={onToggleProviders}
              aria-expanded={providersOpen}
              aria-controls="provider-panel"
              aria-haspopup="dialog"
              title="查看各供应商的采集状态"
              className={cn(
                'inline-flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] transition-colors',
                providersOpen
                  ? 'border-line-strong bg-panel-hover text-fg'
                  : 'border-line bg-panel text-fg-dim hover:bg-panel-hover hover:text-fg',
              )}
            >
              <Server size={13} />
              <span>供应商</span>
              {providers ? (
                <span
                  className={cn(
                    'tabnum',
                    providers.failed > 0 ? 'text-crit' : 'text-ok',
                  )}
                >
                  {providers.ok}/{providers.total}
                </span>
              ) : null}
              <ChevronDown
                size={12}
                className={cn('transition-transform', providersOpen && 'rotate-180')}
              />
            </button>

            {/* 绝对定位的浮层：从按钮下方展开，不把正文往下推。 */}
            {providersOpen ? (
              <div
                id="provider-panel"
                role="dialog"
                aria-modal="false"
                aria-label="供应商采集状态"
                className="absolute top-[calc(100%+8px)] right-0 z-40 max-h-[min(70vh,540px)] w-[min(92vw,860px)] overflow-y-auto rounded-lg border border-line-strong bg-panel p-3 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45)]"
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-[11px] font-semibold tracking-[0.12em] text-fg-dim uppercase">
                      供应商
                    </h2>
                    <span className="text-[11px] text-fg-faint">
                      最近一次采集结果，失败时保留历史数据
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onCloseProviders}
                    className="text-[11px] text-fg-faint transition-colors hover:text-fg"
                  >
                    收起
                  </button>
                </div>
                {providerPanel}
              </div>
            ) : null}
          </div>

          <RetentionControl />

          <label className="hidden items-center gap-1.5 text-[11px] text-fg-faint md:flex">
            自动刷新
            <select
              value={refreshMs}
              onChange={(event) => setRefreshMs(Number(event.target.value))}
              className="tabnum rounded border border-line bg-panel px-1.5 py-1 text-[11px] text-fg-dim outline-none hover:bg-panel-hover"
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="立即刷新全部数据"
            className="inline-flex items-center gap-1.5 rounded border border-line bg-panel px-2 py-1.5 text-[11px] text-fg-dim transition-colors hover:bg-panel-hover hover:text-fg disabled:opacity-60"
          >
            {refreshing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} className={cn(isFetching && 'animate-spin')} />
            )}
            <span className="hidden sm:inline">刷新</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            className="inline-flex items-center rounded border border-line bg-panel p-1.5 text-fg-dim transition-colors hover:bg-panel-hover hover:text-fg"
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>
      </div>
    </header>
  )
}
