import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Infinity as InfinityIcon,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import type { InstanceRef } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Meter } from '@/components/ui/Meter'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { useManualTrafficReset } from '@/hooks/useManualTrafficReset'
import { formatBytes, formatDateTime, formatPercent, formatRelative } from '@/lib/format'
import { isoToLocalMinute, localMinuteToIso } from '@/lib/manualReset'
import type { TrafficModel } from '@/lib/traffic'

function Directions({ inBytes, outBytes }: { inBytes?: number; outBytes?: number }) {
  if (inBytes === undefined && outBytes === undefined) return null
  return (
    <div className="flex flex-wrap gap-4 border-t border-line pt-2 text-[11px]">
      <span className="tnum flex items-center gap-1.5 text-fg-dim">
        <ArrowDown size={11} className="text-accent" />
        入站累计 <span className="text-fg">{formatBytes(inBytes)}</span>
      </span>
      <span className="tnum flex items-center gap-1.5 text-fg-dim">
        <ArrowUp size={11} className="text-ok" />
        出站累计 <span className="text-fg">{formatBytes(outBytes)}</span>
      </span>
    </div>
  )
}

function ResetAt({
  value,
  now,
  manual = false,
}: {
  value: string | undefined
  now: number
  manual?: boolean
}) {
  if (!value) return null
  return (
    <div className="text-[11px] text-fg-faint" title={formatDateTime(value)}>
      下次重置{manual ? '（手动）' : ''}：{formatDateTime(value)}（{formatRelative(value, now)}）
    </div>
  )
}

function ManualResetAt({ instance, now }: { instance: InstanceRef; now: number }) {
  const { value, autoAdvance, save, clear, setAutoAdvance } = useManualTrafficReset(instance, now)
  const [editing, setEditing] = useState(value === undefined)
  const [draft, setDraft] = useState(() => isoToLocalMinute(value))
  const [draftAutoAdvance, setDraftAutoAdvance] = useState(autoAdvance)
  const parsedDraft = localMinuteToIso(draft)

  useEffect(() => {
    setDraft(isoToLocalMinute(value))
    setDraftAutoAdvance(autoAdvance)
    setEditing(value === undefined)
  }, [value, autoAdvance, instance.provider, instance.instanceKey])

  if (value && !editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <ResetAt value={value} now={now} manual />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={autoAdvance}
            title="到期后自动改为下个月同一日期、同一时间"
            onClick={() => setAutoAdvance(!autoAdvance)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
              autoAdvance
                ? 'border-accent/40 bg-accent-soft text-accent'
                : 'border-line bg-panel-soft text-fg-faint hover:bg-panel-hover hover:text-fg'
            }`}
          >
            <RefreshCw size={11} />
            自动顺延：{autoAdvance ? '开启' : '关闭'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded border border-line bg-panel-soft px-2 py-1 text-[11px] text-fg-dim hover:bg-panel-hover hover:text-fg"
          >
            <Pencil size={11} />
            修改
          </button>
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 rounded border border-line bg-panel-soft px-2 py-1 text-[11px] text-fg-faint hover:border-crit/40 hover:text-crit"
          >
            <Trash2 size={11} />
            清除
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="space-y-2 border-t border-line pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (parsedDraft) save(parsedDraft, draftAutoAdvance)
      }}
    >
      <label className="flex items-center gap-1.5 text-[11px] text-fg-dim" htmlFor="manual-reset-at">
        <CalendarClock size={12} className="text-fg-faint" />
        供应商未返回重置时间，可手动设置
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="manual-reset-at"
          type="datetime-local"
          step={60}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="tnum rounded border border-line bg-panel-soft px-2 py-1.5 text-xs text-fg outline-none hover:bg-panel-hover focus:border-line-strong"
        />
        <button
          type="submit"
          disabled={!parsedDraft}
          className="rounded border border-line bg-panel-soft px-2.5 py-1.5 text-xs text-fg-dim hover:bg-panel-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          保存
        </button>
        <button
          type="button"
          aria-pressed={draftAutoAdvance}
          title="到期后自动改为下个月同一日期、同一时间"
          onClick={() => setDraftAutoAdvance((enabled) => !enabled)}
          className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs ${
            draftAutoAdvance
              ? 'border-accent/40 bg-accent-soft text-accent'
              : 'border-line bg-panel-soft text-fg-faint hover:bg-panel-hover hover:text-fg'
          }`}
        >
          <RefreshCw size={12} />
          自动顺延一个月：{draftAutoAdvance ? '开启' : '关闭'}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => {
              setDraft(isoToLocalMinute(value))
              setDraftAutoAdvance(autoAdvance)
              setEditing(false)
            }}
            className="px-1 py-1.5 text-xs text-fg-faint hover:text-fg"
          >
            取消
          </button>
        ) : null}
      </div>
    </form>
  )
}

export function TrafficCard({
  traffic,
  now,
  instance,
}: {
  traffic: TrafficModel
  now: number
  instance: InstanceRef
}) {
  const resetAt = traffic.kind === 'none' ? undefined : traffic.resetAt

  return (
    <Panel>
      <PanelHeader
        title="流量配额"
        actions={
          traffic.kind === 'quota' && traffic.tone !== 'ok' ? (
            <Badge tone={traffic.tone} icon={<TriangleAlert size={11} />}>
              {traffic.tone === 'crit' ? '配额即将耗尽' : '配额已用过半'}
            </Badge>
          ) : null
        }
      />
      <div className="space-y-3 p-4">
        {traffic.kind === 'none' ? (
          <p className="text-xs text-fg-faint">供应商未返回任何流量数据。</p>
        ) : null}

        {traffic.kind === 'unlimited' ? (
          <>
            {traffic.used !== undefined ? (
              <div className="tnum text-xl font-semibold text-fg">
                {formatBytes(traffic.used)}
                <span className="ml-2 text-xs font-normal text-fg-faint">周期已用</span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="muted" icon={<InfinityIcon size={12} />}>
                {traffic.source === 'declared' ? '无限流量 / 带宽型' : '无限流量'}
              </Badge>
              {traffic.billingMode ? (
                <span className="text-[11px] text-fg-faint">计费模式：{traffic.billingMode}</span>
              ) : null}
            </div>
            <p className="text-[11px] text-fg-faint">
              {traffic.source === 'declared'
                ? '供应商声明该实例按带宽计费，没有固定月流量配额，因此不显示百分比。'
                : '供应商只返回已用量、没有返回任何配额上限，按不限流量处理，因此不显示百分比。'}
            </p>
            <Directions inBytes={traffic.inBytes} outBytes={traffic.outBytes} />
            <ResetAt value={traffic.resetAt} now={now} />
          </>
        ) : null}

        {traffic.kind === 'quota' ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div className="tnum text-xl font-semibold text-fg">
                {formatBytes(traffic.used)}
                <span className="text-sm font-normal text-fg-faint"> / {formatBytes(traffic.total)}</span>
              </div>
              <div className="tnum text-sm text-fg-dim">{formatPercent(traffic.percent)}</div>
            </div>
            <Meter percent={traffic.percent} tone={traffic.tone} label="流量配额使用率" height="h-2" />
            <div className="tnum flex justify-between text-[11px] text-fg-faint">
              <span>剩余 {formatBytes(traffic.remaining)}</span>
              <span>总配额 {formatBytes(traffic.total)}</span>
            </div>
            <Directions inBytes={traffic.inBytes} outBytes={traffic.outBytes} />
            <ResetAt value={traffic.resetAt} now={now} />
          </>
        ) : null}

        {traffic.kind !== 'none' && !resetAt ? <ManualResetAt instance={instance} now={now} /> : null}
      </div>
    </Panel>
  )
}
