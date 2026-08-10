/**
 * `docs/API.md` 中只读接口的类型契约。
 *
 * 后端对不同供应商返回的字段并不一致：不支持的指标会被整体省略，
 * 所以 `metrics` / `quota` 一律建模为宽松字典，取值必须经过 `lib/values.ts` 的
 * 安全读取函数，绝不能把缺失字段当成 0。
 */

export type MetricValue = number | string | boolean | null

export type MetricMap = Record<string, MetricValue>

export type MetadataMap = Record<string, unknown>

export interface HealthResponse {
  status: string
  database: string
  latest_observation_at: string | null
}

export interface ProviderStatus {
  provider: string
  ok: boolean
  instance_count: number
  last_collected_at: string
  last_error: string | null
}

export interface ProviderListResponse {
  items: ProviderStatus[]
}

export interface InstanceObservation {
  provider: string
  instance_key: string
  display_name: string
  observed_at: string
  status: string | null
  metrics: MetricMap
  quota: MetricMap
  metadata: MetadataMap
}

export interface InstanceListResponse {
  total: number
  offset: number
  limit: number
  items: InstanceObservation[]
}

export interface LiveQueryResponse {
  provider: 'aliyun_swas'
  requested_at: string
  completed_at: string
  duration_ms: number
  total: number
  items: InstanceObservation[]
}

export interface HistoryPoint {
  observed_at: string
  status: string | null
  metrics: MetricMap
  quota: MetricMap
}

export interface InstanceHistoryResponse {
  provider: string
  instance_key: string
  hours: number
  points: HistoryPoint[]
}

export interface SummaryResponse {
  generated_at: string
  providers_total: number
  providers_ok: number
  instances_total: number
  instances_online: number
  instances_unlimited_traffic: number
  traffic_used_bytes: number
  traffic_total_bytes: number
}

export interface InstanceQuery {
  provider?: string | undefined
  status?: string | undefined
  search?: string | undefined
  offset?: number | undefined
  limit?: number | undefined
}

/** 实例的唯一标识：供应商 + 实例键。 */
export interface InstanceRef {
  provider: string
  instanceKey: string
}

export function instanceId(ref: InstanceRef): string {
  return `${ref.provider}/${ref.instanceKey}`
}

export function refOf(observation: InstanceObservation): InstanceRef {
  return { provider: observation.provider, instanceKey: observation.instance_key }
}
