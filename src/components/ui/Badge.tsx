import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'
import type { Tone } from '@/lib/status'

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  crit: 'text-crit',
  muted: 'text-muted',
}

const TONE_BG: Record<Tone, string> = {
  ok: 'bg-ok-soft',
  warn: 'bg-warn-soft',
  crit: 'bg-crit-soft',
  muted: 'bg-muted-soft',
}

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  muted: 'bg-muted',
}

/**
 * 状态点。颜色之外始终配文字标签，不让信息只依赖颜色。
 */
export function ToneDot({
  tone,
  pulse = false,
  className,
}: {
  tone: Tone
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        TONE_DOT[tone],
        pulse && 'pulse-dot',
        className,
      )}
    />
  )
}

export function Badge({
  tone = 'muted',
  children,
  icon,
  className,
  title,
}: {
  tone?: Tone
  children: ReactNode
  icon?: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border border-transparent px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap',
        TONE_BG[tone],
        TONE_TEXT[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

export function StatusPill({
  tone,
  label,
  pulse = false,
  title,
}: {
  tone: Tone
  label: string
  pulse?: boolean
  title?: string
}) {
  return (
    <span
      title={title ?? label}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap',
        'border-line bg-panel-soft',
        TONE_TEXT[tone],
      )}
    >
      <ToneDot tone={tone} pulse={pulse} />
      {/* 供应商可能返回很长的自定义状态，列宽固定后截断显示，完整值在 title 里。 */}
      <span className="truncate text-fg-dim">{label}</span>
    </span>
  )
}

export function ProviderTag({
  label,
  color,
  className,
}: {
  label: string
  color: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap text-fg-dim',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rotate-45"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}
