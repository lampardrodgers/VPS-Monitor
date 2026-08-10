/**
 * 只读 API 客户端。除了 `VITE_API_BASE_URL` 指向的本地隧道，不会访问任何其他主机。
 */
import { ApiError } from './errors'
import {
  parseHealth,
  parseHistory,
  parseInstance,
  parseInstanceList,
  parseLiveQuery,
  parseProviderList,
  parseSummary,
} from './parse'
import type {
  HealthResponse,
  InstanceHistoryResponse,
  InstanceListResponse,
  InstanceObservation,
  InstanceQuery,
  InstanceRef,
  LiveQueryResponse,
  ProviderListResponse,
  SummaryResponse,
} from './types'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787'
const REQUEST_TIMEOUT_MS = 15_000

/** 单页最大条数由后端限制（1–500）。 */
export const MAX_PAGE_SIZE = 500
/** 全量抓取的兜底上限，避免异常数据把浏览器拖死。 */
const MAX_FETCH_ALL = 2_000

export const apiBaseUrl: string = (
  import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL
).replace(/\/+$/, '')

function buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(`${apiBaseUrl}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function readDetail(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
    }
  } catch {
    // 错误响应不是 JSON 时忽略，由状态码给出文案。
  }
  return undefined
}

async function request<T>(
  path: string,
  parse: (raw: unknown) => T,
  options: {
    params?: Record<string, string | number | undefined>
    signal?: AbortSignal
    cache?: RequestCache
  } = {},
): Promise<T> {
  const url = buildUrl(path, options.params)
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
      cache: options.cache,
    })
  } catch (error) {
    // 调用方主动取消（组件卸载 / 查询失效）要原样抛出，不能显示成隧道断开。
    if (options.signal?.aborted) throw error
    if (timeout.aborted) {
      throw new ApiError('请求超时', { kind: 'timeout', url })
    }
    throw new ApiError('无法连接到本地 API', { kind: 'network', url })
  }

  if (!response.ok) {
    const detail = await readDetail(response)
    throw new ApiError(detail ?? `HTTP ${response.status}`, {
      kind: 'http',
      status: response.status,
      detail,
      url,
    })
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('API 响应不是合法 JSON', { kind: 'parse', url })
  }
  return parse(payload)
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request('/health', parseHealth, { signal })
}

export function fetchSummary(signal?: AbortSignal): Promise<SummaryResponse> {
  return request('/api/v1/summary', parseSummary, { signal })
}

export function fetchProviders(signal?: AbortSignal): Promise<ProviderListResponse> {
  return request('/api/v1/providers', parseProviderList, { signal })
}

/** 每次调用都会让服务端重新查询阿里云，浏览器不得复用 HTTP 缓存。 */
export function fetchLiveAliyun(signal?: AbortSignal): Promise<LiveQueryResponse> {
  return request('/api/v1/live/aliyun_swas', parseLiveQuery, {
    signal,
    cache: 'no-store',
  })
}

export function fetchInstances(
  query: InstanceQuery = {},
  signal?: AbortSignal,
): Promise<InstanceListResponse> {
  return request('/api/v1/instances', parseInstanceList, {
    signal,
    params: {
      provider: query.provider,
      status: query.status,
      search: query.search,
      offset: query.offset ?? 0,
      limit: query.limit ?? 100,
    },
  })
}

/**
 * 抓完所有分页。实例数量增长（随时新增 VPS）时不需要改前端：
 * 只要总数还在上限内，列表、筛选和排序都会自动覆盖新实例。
 */
export async function fetchAllInstances(
  query: Omit<InstanceQuery, 'offset' | 'limit'> = {},
  signal?: AbortSignal,
): Promise<InstanceListResponse> {
  const first = await fetchInstances({ ...query, offset: 0, limit: MAX_PAGE_SIZE }, signal)
  const items = [...first.items]
  let offset = items.length

  while (items.length < Math.min(first.total, MAX_FETCH_ALL) && first.items.length > 0) {
    const next = await fetchInstances({ ...query, offset, limit: MAX_PAGE_SIZE }, signal)
    if (next.items.length === 0) break
    items.push(...next.items)
    offset += next.items.length
  }

  return { total: first.total, offset: 0, limit: items.length, items }
}

export function fetchInstance(
  ref: InstanceRef,
  signal?: AbortSignal,
): Promise<InstanceObservation> {
  return request(
    `/api/v1/instances/${encodeURIComponent(ref.provider)}/${encodeURIComponent(ref.instanceKey)}`,
    parseInstance,
    { signal },
  )
}

export function fetchHistory(
  ref: InstanceRef,
  options: { hours: number; limit: number },
  signal?: AbortSignal,
): Promise<InstanceHistoryResponse> {
  return request(
    `/api/v1/instances/${encodeURIComponent(ref.provider)}/${encodeURIComponent(
      ref.instanceKey,
    )}/history`,
    parseHistory,
    { signal, params: { hours: options.hours, limit: options.limit } },
  )
}
