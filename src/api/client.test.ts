import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  apiBaseUrl,
  fetchAllInstances,
  fetchHealth,
  fetchHistory,
  fetchInstance,
  fetchInstances,
  fetchLiveAliyun,
} from '@/api/client'
import { ApiError, describeApiError } from '@/api/errors'
import { retryDelay, shouldRetry } from '@/api/QueryProvider'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return handler(new URL(raw), init)
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('请求构造', () => {
  it('默认 Base URL 指向本地隧道', () => {
    expect(apiBaseUrl).toBe('http://127.0.0.1:8787')
  })

  it('把筛选条件写进查询串，跳过空值', async () => {
    const spy = stubFetch(() => jsonResponse({ total: 0, offset: 0, limit: 100, items: [] }))
    await fetchInstances({ provider: 'panstar', search: '', offset: 0, limit: 50 })

    const called = new URL(String(spy.mock.calls[0]?.[0]))
    expect(called.pathname).toBe('/api/v1/instances')
    expect(called.searchParams.get('provider')).toBe('panstar')
    expect(called.searchParams.get('limit')).toBe('50')
    expect(called.searchParams.has('search')).toBe(false)
  })

  it('对实例键做 URL 编码', async () => {
    const spy = stubFetch(() =>
      jsonResponse({
        provider: 'p',
        instance_key: 'a/b',
        display_name: 'n',
        observed_at: '2026-08-10T03:30:00+00:00',
      }),
    )
    await fetchInstance({ provider: 'p', instanceKey: 'a/b' })
    expect(String(spy.mock.calls[0]?.[0])).toContain('/api/v1/instances/p/a%2Fb')
  })

  it('历史接口传递 hours 与 limit', async () => {
    const spy = stubFetch(() =>
      jsonResponse({ provider: 'p', instance_key: 'k', hours: 720, points: [] }),
    )
    await fetchHistory({ provider: 'p', instanceKey: 'k' }, { hours: 720, limit: 10000 })
    const called = new URL(String(spy.mock.calls[0]?.[0]))
    expect(called.searchParams.get('hours')).toBe('720')
    expect(called.searchParams.get('limit')).toBe('10000')
  })

  it('阿里云实时接口禁用浏览器缓存', async () => {
    const spy = stubFetch(() =>
      jsonResponse({
        provider: 'aliyun_swas',
        requested_at: '2026-08-10T07:24:47+00:00',
        completed_at: '2026-08-10T07:24:50+00:00',
        duration_ms: 2690,
        total: 0,
        items: [],
      }),
    )
    await fetchLiveAliyun()

    const called = new URL(String(spy.mock.calls[0]?.[0]))
    expect(called.pathname).toBe('/api/v1/live/aliyun_swas')
    expect(spy.mock.calls[0]?.[1]?.cache).toBe('no-store')
  })
})

describe('错误处理', () => {
  it('fetch 失败识别为隧道断开', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(fetchHealth()).rejects.toMatchObject({ kind: 'network' })

    const error = await fetchHealth().catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect(describeApiError(error).title).toBe('SSH 隧道未连接或 API 未启动')
  })

  it('503 带上后端 detail', async () => {
    stubFetch(() => jsonResponse({ detail: '监控数据库不可用' }, 503))
    const error = await fetchHealth().catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw new Error('类型收窄失败')
    expect(error.isDatabaseDown).toBe(true)
    expect(error.isTerminal).toBe(false)
    expect(describeApiError(error).title).toBe('监控数据库不可用')
  })

  it('404 为终止错误，不再重试', async () => {
    stubFetch(() => jsonResponse({ detail: '实例不存在' }, 404))
    const error = await fetchInstance({ provider: 'p', instanceKey: 'missing' }).catch(
      (reason: unknown) => reason,
    )
    if (!(error instanceof ApiError)) throw new Error('应为 ApiError')
    expect(error.isNotFound).toBe(true)
    expect(error.isTerminal).toBe(true)
    expect(shouldRetry(0, error)).toBe(false)
  })

  it('响应不是合法 JSON 时抛出 parse 错误', async () => {
    stubFetch(() => new Response('<html>oops</html>', { status: 200 }))
    const error = await fetchHealth().catch((reason: unknown) => reason)
    if (!(error instanceof ApiError)) throw new Error('应为 ApiError')
    expect(error.kind).toBe('parse')
  })
})

describe('fetchAllInstances', () => {
  it('单页返回时只请求一次', async () => {
    const spy = stubFetch(() =>
      jsonResponse({
        total: 1,
        offset: 0,
        limit: 500,
        items: [
          {
            provider: 'p',
            instance_key: 'k',
            display_name: 'n',
            observed_at: '2026-08-10T03:30:00+00:00',
          },
        ],
      }),
    )
    const result = await fetchAllInstances()
    expect(result.items).toHaveLength(1)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('实例数超过单页上限时继续翻页', async () => {
    const total = 620
    const spy = stubFetch((url) => {
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 500)
      const count = Math.max(0, Math.min(limit, total - offset))
      return jsonResponse({
        total,
        offset,
        limit,
        items: Array.from({ length: count }, (_, index) => ({
          provider: 'p',
          instance_key: `k${offset + index}`,
          display_name: `n${offset + index}`,
          observed_at: '2026-08-10T03:30:00+00:00',
        })),
      })
    })

    const result = await fetchAllInstances()
    expect(result.items).toHaveLength(total)
    expect(result.total).toBe(total)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('重试策略', () => {
  it('指数退避且不超过 5 分钟', () => {
    expect(retryDelay(0)).toBe(1_000)
    expect(retryDelay(3)).toBe(8_000)
    expect(retryDelay(20)).toBe(300_000)
  })

  it('网络错误继续重试，达到上限后停止', () => {
    const networkError = new ApiError('x', { kind: 'network' })
    expect(shouldRetry(0, networkError)).toBe(true)
    expect(shouldRetry(8, networkError)).toBe(false)
  })
})
