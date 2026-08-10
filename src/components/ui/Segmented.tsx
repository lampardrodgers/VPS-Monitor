import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

/** 小型分段控件：时间范围、视图切换等。键盘可用（原生 button + 焦点环）。 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex rounded border border-line bg-panel-soft p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-[3px] px-2 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-panel text-fg shadow-[0_1px_0_rgba(0,0,0,0.15)]'
                : 'text-fg-faint hover:text-fg-dim',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
