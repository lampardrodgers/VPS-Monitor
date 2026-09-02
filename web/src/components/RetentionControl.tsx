import { Database, Loader2, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useRetentionSettings, useUpdateRetentionSettings } from '@/api/queries'

const MIN_DAYS = 1
const MAX_DAYS = 3650

export function RetentionControl() {
  const [open, setOpen] = useState(false)
  const [historyDays, setHistoryDays] = useState(7)
  const [runDays, setRunDays] = useState(30)
  const rootRef = useRef<HTMLDivElement>(null)
  const settings = useRetentionSettings(open)
  const update = useUpdateRetentionSettings()

  useEffect(() => {
    if (!settings.data) return
    setHistoryDays(settings.data.history_retention_days)
    setRunDays(settings.data.run_retention_days)
  }, [settings.data])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const valid =
    Number.isInteger(historyDays) &&
    Number.isInteger(runDays) &&
    historyDays >= MIN_DAYS &&
    historyDays <= MAX_DAYS &&
    runDays >= MIN_DAYS &&
    runDays <= MAX_DAYS

  const save = async () => {
    if (!valid) return
    try {
      await update.mutateAsync({
        history_retention_days: historyDays,
        run_retention_days: runDays,
      })
      setOpen(false)
    } catch {
      // mutation.error 在面板内显示具体错误。
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="设置曲线和采集日志保留时间"
        className="inline-flex items-center gap-1.5 rounded border border-line bg-panel px-2 py-1.5 text-[11px] text-fg-dim transition-colors hover:bg-panel-hover hover:text-fg"
      >
        <Settings2 size={13} />
        <span className="hidden sm:inline">保留</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="数据保留设置"
          className="absolute top-[calc(100%+8px)] right-0 z-50 w-[min(90vw,320px)] rounded-lg border border-line-strong bg-panel p-4 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45)]"
        >
          <div className="mb-3 flex items-center gap-2">
            <Database size={15} className="text-accent" />
            <div>
              <h2 className="text-[12px] font-semibold text-fg">数据保留</h2>
              <p className="text-[10px] text-fg-faint">实际写入服务器 SQLite 的保留期限</p>
            </div>
          </div>

          {settings.isPending ? (
            <div className="flex h-24 items-center justify-center text-fg-faint">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-4 text-[11px] text-fg-dim">
                曲线历史
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={MIN_DAYS}
                    max={MAX_DAYS}
                    value={historyDays}
                    onChange={(event) => setHistoryDays(Number(event.target.value))}
                    className="tabnum w-20 rounded border border-line bg-bg px-2 py-1 text-right text-fg outline-none focus:border-accent"
                  />
                  天
                </span>
              </label>
              <label className="flex items-center justify-between gap-4 text-[11px] text-fg-dim">
                采集日志
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={MIN_DAYS}
                    max={MAX_DAYS}
                    value={runDays}
                    onChange={(event) => setRunDays(Number(event.target.value))}
                    className="tabnum w-20 rounded border border-line bg-bg px-2 py-1 text-right text-fg outline-none focus:border-accent"
                  />
                  天
                </span>
              </label>
              <p className="rounded border border-warn/30 bg-warn-soft px-2 py-1.5 text-[10px] leading-relaxed text-warn">
                缩短期限会立即清理过期数据；之后再调大不能恢复已经删除的曲线。
              </p>
              {settings.error || update.error ? (
                <p className="text-[10px] text-crit">
                  {(update.error ?? settings.error)?.message ?? '保存失败'}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded border border-line px-2.5 py-1 text-[11px] text-fg-dim hover:bg-panel-hover"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!valid || update.isPending}
                  onClick={save}
                  className="rounded border border-accent/50 bg-accent/10 px-2.5 py-1 text-[11px] text-accent hover:bg-accent/15 disabled:opacity-50"
                >
                  {update.isPending ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
