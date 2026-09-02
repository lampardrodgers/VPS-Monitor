import { ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Waves } from 'lucide-react'
import type { ReactNode } from 'react'

import { Meter } from '@/components/ui/Meter'
import { EMPTY, formatBitrate, formatBytes, formatNumber, formatPercent } from '@/lib/format'
import type { InstanceView } from '@/lib/instance'
import { usageTone } from '@/lib/status'

function Stat({
  icon,
  label,
  value,
  detail,
  meter,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  detail?: ReactNode
  meter?: ReactNode
}) {
  return (
    <div className="panel flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] tracking-wide text-fg-faint uppercase">
        {icon}
        {label}
      </div>
      <div className="tnum text-base leading-6 font-semibold text-fg">{value}</div>
      {detail ? <div className="tnum text-[11px] text-fg-faint">{detail}</div> : null}
      {meter}
    </div>
  )
}

export function ResourceGrid({ view }: { view: InstanceView }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Stat
        icon={<Cpu size={11} />}
        label="CPU"
        value={formatPercent(view.cpuPercent)}
        detail={view.meta.cpuCores !== undefined ? `${view.meta.cpuCores} 核` : undefined}
        meter={
          <Meter
            percent={view.cpuPercent}
            tone={usageTone(view.cpuPercent)}
            label="CPU 使用率"
            height="h-1"
          />
        }
      />
      <Stat
        icon={<MemoryStick size={11} />}
        label="内存"
        value={formatBytes(view.memory.used)}
        detail={`共 ${formatBytes(view.memory.total)} · ${formatPercent(view.memory.percent)}`}
        meter={
          <Meter
            percent={view.memory.percent}
            tone={usageTone(view.memory.percent)}
            label="内存使用率"
            height="h-1"
          />
        }
      />
      <Stat
        icon={<HardDrive size={11} />}
        label="磁盘"
        value={formatBytes(view.disk.used)}
        detail={`共 ${formatBytes(view.disk.total)} · ${formatPercent(view.disk.percent)}`}
        meter={
          <Meter
            percent={view.disk.percent}
            tone={usageTone(view.disk.percent)}
            label="磁盘使用率"
            height="h-1"
          />
        }
      />
      <Stat
        icon={<ArrowDown size={11} />}
        label="入站速率"
        value={formatBitrate(view.netInBps)}
      />
      <Stat
        icon={<ArrowUp size={11} />}
        label="出站速率"
        value={formatBitrate(view.netOutBps)}
      />
      <Stat
        icon={<Waves size={11} />}
        label="系统负载"
        value={view.loadAverage === undefined ? EMPTY : formatNumber(view.loadAverage)}
        detail={view.loadAverage === undefined ? '供应商不提供' : 'load average'}
      />
    </div>
  )
}
