/**
 * 把一条 `InstanceObservation` 折算成界面直接可用的视图模型。
 * 所有供应商差异都在这里被吸收，组件不再直接读原始字段。
 */
import type { InstanceObservation, InstanceRef, LiveQueryResponse } from '@/api/types'
import { instanceId, refOf } from '@/api/types'
import { parseTimestamp } from '@/lib/format'
import { isStale, normalizeStatus, type StatusInfo } from '@/lib/status'
import { providerMeta, type ProviderMeta } from '@/lib/providers'
import { describeTraffic, type TrafficModel } from '@/lib/traffic'
import { ratioToPercent, readNumber, readPathNumber, readPathText, readText } from '@/lib/values'
import { apiCountryCode } from '@/lib/country'

export interface Usage {
  used: number | undefined
  total: number | undefined
  percent: number | undefined
}

export interface InstanceMeta {
  region: string | undefined
  os: string | undefined
  plan: string | undefined
  cpuCores: number | undefined
  expiresAt: string | undefined
  bandwidthMbps: number | undefined
  trafficUpdatedAt: string | undefined
}

export interface InstanceView {
  id: string
  ref: InstanceRef
  provider: ProviderMeta
  name: string
  originalName: string
  apiCountryCode: string | undefined
  countryCode: string | undefined
  countrySource: 'api' | 'manual' | undefined
  observedAt: number | undefined
  observedAtRaw: string
  stale: boolean
  status: StatusInfo
  cpuPercent: number | undefined
  memory: Usage
  disk: Usage
  netInBps: number | undefined
  netOutBps: number | undefined
  loadAverage: number | undefined
  traffic: TrafficModel
  meta: InstanceMeta
  raw: InstanceObservation
}

function usage(used: number | undefined, total: number | undefined): Usage {
  return { used, total, percent: ratioToPercent(used, total) }
}

function readMemory(observation: InstanceObservation): Usage {
  const total = readNumber(observation.metrics, 'memory_total_bytes')
  const used = readNumber(observation.metrics, 'memory_used_bytes')
  if (used !== undefined) return usage(used, total)
  // 只给了可用内存时反推已用量。
  const available = readNumber(observation.metrics, 'memory_available_bytes')
  if (available !== undefined && total !== undefined) {
    return usage(Math.max(0, total - available), total)
  }
  return usage(undefined, total)
}

function readMeta(observation: InstanceObservation): InstanceMeta {
  const metadata = observation.metadata
  return {
    region: readText(metadata, 'region', 'region_id', 'location', 'node', 'datacenter'),
    os: readText(metadata, 'os', 'os_name', 'template', 'operating_system'),
    plan:
      readPathText(metadata, ['plan', 'name']) ??
      readText(metadata, 'plan_id', 'plan_name', 'package', 'product'),
    cpuCores:
      readNumber(observation.metrics, 'cpu_cores') ??
      readPathNumber(metadata, ['cpu_cores']) ??
      readPathNumber(metadata, ['plan', 'cpu']),
    expiresAt: readText(metadata, 'expires_at', 'expire_at', 'expiry', 'due_date'),
    bandwidthMbps:
      readPathNumber(metadata, ['peak_bandwidth_mbps']) ??
      readPathNumber(metadata, ['bandwidth_mbps']) ??
      readPathNumber(metadata, ['plan', 'bindwidth']),
    trafficUpdatedAt: readText(metadata, 'traffic_updated_at'),
  }
}

export function toInstanceView(
  observation: InstanceObservation,
  now: number = Date.now(),
): InstanceView {
  const observedAt = parseTimestamp(observation.observed_at)
  const originalName = observation.display_name || observation.instance_key
  const countryCode = apiCountryCode(observation.metadata)
  return {
    id: instanceId(refOf(observation)),
    ref: refOf(observation),
    provider: providerMeta(observation.provider),
    name: originalName,
    originalName,
    apiCountryCode: countryCode,
    countryCode,
    countrySource: countryCode ? 'api' : undefined,
    observedAt,
    observedAtRaw: observation.observed_at,
    stale: isStale(observedAt, now),
    status: normalizeStatus(observation.status),
    cpuPercent: readNumber(observation.metrics, 'cpu_percent'),
    memory: readMemory(observation),
    disk: usage(
      readNumber(observation.metrics, 'disk_used_bytes'),
      readNumber(observation.metrics, 'disk_total_bytes'),
    ),
    netInBps: readNumber(observation.metrics, 'network_in_bps'),
    netOutBps: readNumber(observation.metrics, 'network_out_bps'),
    loadAverage: readNumber(observation.metrics, 'load_average'),
    traffic: describeTraffic(observation.quota),
    meta: readMeta(observation),
    raw: observation,
  }
}

export function toInstanceViews(
  observations: readonly InstanceObservation[],
  now: number = Date.now(),
): InstanceView[] {
  return observations.map((observation) => toInstanceView(observation, now))
}

/**
 * 用一次实时查询覆盖缓存列表中对应的阿里云实例。
 * 其他供应商以及本轮实时响应未包含的缓存实例保持不变；新发现的阿里云实例会追加进来。
 */
export function mergeLiveInstances(
  cached: readonly InstanceObservation[],
  live: LiveQueryResponse | undefined,
): InstanceObservation[] {
  if (!live) return [...cached]

  const replacements = new Map(
    live.items
      .filter((item) => item.provider === live.provider)
      .map((item) => [instanceId(refOf(item)), item] as const),
  )
  const seen = new Set<string>()
  const merged = cached.map((item) => {
    const id = instanceId(refOf(item))
    const replacement = replacements.get(id)
    if (replacement) seen.add(id)
    return replacement ?? item
  })

  for (const item of replacements.values()) {
    const id = instanceId(refOf(item))
    if (!seen.has(id)) merged.push(item)
  }
  return merged
}

export interface TrafficRollup {
  /** 不限流量的实例数（含“只有用量、没有配额”被推断为不限流量的）。 */
  unlimited: number
  /** 有固定配额的实例数。 */
  quota: number
  quotaUsedBytes: number
  quotaTotalBytes: number
  quotaPercent: number | undefined
  /** 完全没有流量数据的实例数。 */
  unknown: number
}

/**
 * 流量汇总在前端算，而不是直接用 `/api/v1/summary`。
 *
 * 后端只把 `traffic_unlimited=true` 记为无限流量，并且会把“只有已用量”的实例
 * 计入 `traffic_used_bytes`；前端把这类实例视作不限流量，两边口径不同，
 * 因此这两块必须由列表数据自己算，才能和表格里的显示对得上。
 */
export function rollupTraffic(views: readonly InstanceView[]): TrafficRollup {
  const rollup: TrafficRollup = {
    unlimited: 0,
    quota: 0,
    quotaUsedBytes: 0,
    quotaTotalBytes: 0,
    quotaPercent: undefined,
    unknown: 0,
  }

  for (const view of views) {
    if (view.traffic.kind === 'unlimited') {
      rollup.unlimited += 1
    } else if (view.traffic.kind === 'quota') {
      rollup.quota += 1
      rollup.quotaUsedBytes += view.traffic.used
      rollup.quotaTotalBytes += view.traffic.total
    } else {
      rollup.unknown += 1
    }
  }

  rollup.quotaPercent = ratioToPercent(rollup.quotaUsedBytes, rollup.quotaTotalBytes)
  return rollup
}
