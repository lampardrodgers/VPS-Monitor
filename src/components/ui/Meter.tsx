import { cn } from '@/lib/cn'
import { EMPTY, formatPercent } from '@/lib/format'
import type { Tone } from '@/lib/status'

const TONE_FILL: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  muted: 'bg-muted',
}

/**
 * 使用率条。`percent === undefined` 表示供应商没有返回该指标，
 * 显示为空槽而不是 0%。
 */
export function Meter({
  percent,
  tone,
  label,
  className,
  height = 'h-1.5',
  showValue = false,
}: {
  percent: number | undefined
  tone: Tone
  label: string
  className?: string
  height?: string
  showValue?: boolean
}) {
  const known = percent !== undefined

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(percent) : undefined}
        aria-valuetext={known ? formatPercent(percent) : '无数据'}
        className={cn('relative w-full overflow-hidden rounded-full bg-panel-hover', height)}
      >
        {known ? (
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', TONE_FILL[tone])}
            style={{ width: `${Math.max(percent > 0 ? 2 : 0, percent)}%` }}
          />
        ) : (
          <div className="h-full w-full bg-[repeating-linear-gradient(135deg,var(--panel-hover)_0_6px,transparent_6px_12px)]" />
        )}
      </div>
      {showValue ? (
        <span className="tnum w-12 shrink-0 text-right text-xs text-fg-dim">
          {known ? formatPercent(percent, { digits: 0 }) : EMPTY}
        </span>
      ) : null}
    </div>
  )
}
