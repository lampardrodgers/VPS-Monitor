import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export function Panel({
  children,
  className,
  as: Component = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
}) {
  return (
    <Component className={cn('panel', className)}>
      {children}
    </Component>
  )
}

export function PanelHeader({
  title,
  subtitle,
  icon,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="text-fg-faint">{icon}</span> : null}
        <h2 className="truncate text-[13px] font-semibold tracking-wide text-fg uppercase">
          {title}
        </h2>
        {subtitle ? <span className="truncate text-xs text-fg-faint">{subtitle}</span> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
