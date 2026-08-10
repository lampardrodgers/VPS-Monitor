import { AlertTriangle, Inbox, PlugZap, RefreshCw, SearchX } from 'lucide-react'
import type { ReactNode } from 'react'

import { describeApiError } from '@/api/errors'
import { cn } from '@/lib/cn'

function Shell({
  icon,
  title,
  hint,
  action,
  tone = 'muted',
  className,
}: {
  icon: ReactNode
  title: string
  hint?: ReactNode
  action?: ReactNode
  tone?: 'muted' | 'crit' | 'warn'
  className?: string
}) {
  const toneClass =
    tone === 'crit' ? 'text-crit' : tone === 'warn' ? 'text-warn' : 'text-fg-faint'
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}
    >
      <span className={toneClass}>{icon}</span>
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="max-w-lg text-xs leading-relaxed text-fg-faint">{hint}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const { title, hint } = describeApiError(error)
  const tunnel = title.includes('隧道')
  return (
    <Shell
      className={className}
      tone="crit"
      icon={tunnel ? <PlugZap size={22} /> : <AlertTriangle size={22} />}
      title={title}
      hint={hint}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded border border-line bg-panel-soft px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:bg-panel-hover hover:text-fg"
          >
            <RefreshCw size={13} />
            重试
          </button>
        ) : null
      }
    />
  )
}

export function EmptyState({
  title,
  hint,
  action,
  className,
}: {
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <Shell className={className} icon={<Inbox size={22} />} title={title} hint={hint} action={action} />
  )
}

export function NoResultState({ onClear, className }: { onClear: () => void; className?: string }) {
  return (
    <Shell
      className={className}
      icon={<SearchX size={22} />}
      title="没有符合条件的实例"
      hint="试试放宽供应商、状态或关键字筛选。"
      action={
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-line bg-panel-soft px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:bg-panel-hover hover:text-fg"
        >
          清除筛选
        </button>
      }
    />
  )
}
