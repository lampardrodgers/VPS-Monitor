/**
 * 宽松但严格落地的响应解析。
 *
 * 后端随时可能新增字段或新增供应商，所以解析器只校验前端真正依赖的字段，
 * 其余原样保留；关键字段类型不符时抛出 `ApiError('parse')`，避免把脏数据画进图表。
 */
import { ApiError } from './errors'
import type {
  HealthResponse,
  HistoryPoint,
  InstanceHistoryResponse,
  InstanceListResponse,
  InstanceObservation,
  LiveQueryResponse,
  MetricMap,
  MetadataMap,
  ProviderListResponse,
  ProviderStatus,
  RetentionSettings,
  SummaryResponse,
} from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(what: string): never {
  throw new ApiError(`API 返回的 ${what} 格式无法解析`, { kind: 'parse' })
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) fail(what)
  return value
}

function readString(source: Record<string, unknown>, key: string, what: string): string {
  const value = source[key]
  if (typeof value !== 'string') fail(`${what}.${key}`)
  return value
}

function readOptionalString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' ? value : null
}

function readNumber(source: Record<string, unknown>, key: string, what: string): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what}.${key}`)
  return value
}

function readBoolean(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true
}

/** metrics / quota：只保留标量，嵌套结构对图表没有意义。 */
function readMetricMap(source: Record<string, unknown>, key: string): MetricMap {
  const value = source[key]
  if (!isRecord(value)) return {}
  const result: MetricMap = {}
  for (const [field, item] of Object.entries(value)) {
    if (item === null || ['number', 'string', 'boolean'].includes(typeof item)) {
      result[field] = item as MetricMap[string]
    }
  }
  return result
}

function readMetadata(source: Record<string, unknown>, key: string): MetadataMap {
  const value = source[key]
  return isRecord(value) ? value : {}
}

export function parseHealth(raw: unknown): HealthResponse {
  const record = requireRecord(raw, 'health')
  return {
    status: readString(record, 'status', 'health'),
    database: readOptionalString(record, 'database') ?? 'unknown',
    latest_observation_at: readOptionalString(record, 'latest_observation_at'),
  }
}

export function parseProviderStatus(raw: unknown): ProviderStatus {
  const record = requireRecord(raw, 'provider')
  return {
    provider: readString(record, 'provider', 'provider'),
    ok: readBoolean(record, 'ok'),
    instance_count:
      typeof record['instance_count'] === 'number' ? (record['instance_count'] as number) : 0,
    last_collected_at: readOptionalString(record, 'last_collected_at') ?? '',
    last_error: readOptionalString(record, 'last_error'),
  }
}

export function parseProviderList(raw: unknown): ProviderListResponse {
  const record = requireRecord(raw, 'providers')
  const items = record['items']
  if (!Array.isArray(items)) fail('providers.items')
  return { items: items.map(parseProviderStatus) }
}

export function parseInstance(raw: unknown): InstanceObservation {
  const record = requireRecord(raw, 'instance')
  return {
    provider: readString(record, 'provider', 'instance'),
    instance_key: readString(record, 'instance_key', 'instance'),
    display_name:
      readOptionalString(record, 'display_name') ?? readString(record, 'instance_key', 'instance'),
    observed_at: readString(record, 'observed_at', 'instance'),
    status: readOptionalString(record, 'status'),
    metrics: readMetricMap(record, 'metrics'),
    quota: readMetricMap(record, 'quota'),
    metadata: readMetadata(record, 'metadata'),
  }
}

export function parseInstanceList(raw: unknown): InstanceListResponse {
  const record = requireRecord(raw, 'instances')
  const items = record['items']
  if (!Array.isArray(items)) fail('instances.items')
  const parsed = items.map(parseInstance)
  return {
    total: typeof record['total'] === 'number' ? (record['total'] as number) : parsed.length,
    offset: typeof record['offset'] === 'number' ? (record['offset'] as number) : 0,
    limit: typeof record['limit'] === 'number' ? (record['limit'] as number) : parsed.length,
    items: parsed,
  }
}

export function parseLiveQuery(raw: unknown): LiveQueryResponse {
  const record = requireRecord(raw, 'live')
  const items = record['items']
  if (!Array.isArray(items)) fail('live.items')
  const provider = readString(record, 'provider', 'live')
  if (provider !== 'aliyun_swas') fail('live.provider')
  const parsed = items.map(parseInstance)
  return {
    provider,
    requested_at: readString(record, 'requested_at', 'live'),
    completed_at: readString(record, 'completed_at', 'live'),
    duration_ms: readNumber(record, 'duration_ms', 'live'),
    total: readNumber(record, 'total', 'live'),
    items: parsed,
  }
}

export function parseHistoryPoint(raw: unknown): HistoryPoint {
  const record = requireRecord(raw, 'history.point')
  return {
    observed_at: readString(record, 'observed_at', 'history.point'),
    status: readOptionalString(record, 'status'),
    metrics: readMetricMap(record, 'metrics'),
    quota: readMetricMap(record, 'quota'),
  }
}

export function parseHistory(raw: unknown): InstanceHistoryResponse {
  const record = requireRecord(raw, 'history')
  const points = record['points']
  if (!Array.isArray(points)) fail('history.points')
  return {
    provider: readString(record, 'provider', 'history'),
    instance_key: readString(record, 'instance_key', 'history'),
    hours: typeof record['hours'] === 'number' ? (record['hours'] as number) : 24,
    points: points.map(parseHistoryPoint),
  }
}

export function parseSummary(raw: unknown): SummaryResponse {
  const record = requireRecord(raw, 'summary')
  return {
    generated_at: readString(record, 'generated_at', 'summary'),
    providers_total: readNumber(record, 'providers_total', 'summary'),
    providers_ok: readNumber(record, 'providers_ok', 'summary'),
    instances_total: readNumber(record, 'instances_total', 'summary'),
    instances_online: readNumber(record, 'instances_online', 'summary'),
    instances_unlimited_traffic: readNumber(record, 'instances_unlimited_traffic', 'summary'),
    traffic_used_bytes: readNumber(record, 'traffic_used_bytes', 'summary'),
    traffic_total_bytes: readNumber(record, 'traffic_total_bytes', 'summary'),
  }
}

export function parseRetentionSettings(raw: unknown): RetentionSettings {
  const record = requireRecord(raw, 'settings.retention')
  return {
    history_retention_days: readNumber(
      record,
      'history_retention_days',
      'settings.retention',
    ),
    run_retention_days: readNumber(record, 'run_retention_days', 'settings.retention'),
    updated_at: readOptionalString(record, 'updated_at'),
  }
}
