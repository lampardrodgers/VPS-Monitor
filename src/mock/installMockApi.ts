/**
 * 开发期 mock：`VITE_USE_MOCK=1 npm run dev` 时拦截对 API 的 fetch。
 *
 * 仅在开发模式生效。生产构建里 `import.meta.env.DEV` 为 `false`，
 * 整个函数体会被摇树移除，绝不会在真实 API 不可用时静默回退到假数据。
 */
import { apiBaseUrl } from '@/api/client'

const PROVIDERS = [
  { id: 'bandwagon', ok: true, error: null },
  { id: 'aliyun_swas', ok: true, error: null },
  { id: 'panstar', ok: true, error: null },
  { id: 'dedione', ok: true, error: null },
  {
    id: 'greencloud',
    ok: false,
    error: 'GreenCloud API 被 Cloudflare JavaScript Challenge 拦截（HTTP 403，cf-mitigated: challenge）',
  },
] as const

interface MockInstance {
  provider: string
  key: string
  name: string
  status: string
  minutesStale: number
  cpu: boolean
  /** [已用, 总量]，已用为 null 表示供应商只给总量。 */
  memory: [number | null, number] | null
  disk: [number | null, number] | null
  network: boolean
  traffic: 'quota' | 'unlimited' | 'used-only' | 'none'
  metadata: Record<string, unknown>
}

const GB = 1024 ** 3

const INSTANCES: MockInstance[] = [
  {
    provider: 'bandwagon',
    key: 'demo-bwg-001',
    name: 'Example Bandwagon',
    status: 'running',
    minutesStale: 3,
    cpu: false,
    memory: [0.6 * GB, 1 * GB],
    disk: [7 * GB, 20 * GB],
    network: false,
    traffic: 'quota',
    metadata: { region: 'Example Region A', os: 'debian 12', plan: 'Example Plan A' },
  },
  {
    provider: 'aliyun_swas',
    key: 'demo-swas-001',
    name: 'Example SWAS',
    status: 'Running',
    minutesStale: 2,
    cpu: true,
    memory: [1.1 * GB, 2 * GB],
    disk: [10.4 * GB, 40 * GB],
    network: true,
    traffic: 'unlimited',
    metadata: {
      region_id: 'example-region-b',
      os: 'ubuntu 22.04',
      plan_id: 'example.swas.c2m2s40',
      peak_bandwidth_mbps: 200,
      expires_at: '2030-01-15T00:00:00Z',
      cpu_cores: 2,
    },
  },
  {
    provider: 'panstar',
    key: 'demo-pan-001',
    name: 'Example Panstar A',
    status: 'READY',
    minutesStale: 4,
    cpu: false,
    memory: [null, 0.5 * GB],
    disk: [null, 10 * GB],
    network: false,
    traffic: 'quota',
    metadata: { plan: { name: 'Example Nano A', cpu: 1 }, os: 'debian 12', expires_at: '2030-02-01T00:00:00Z' },
  },
  {
    provider: 'panstar',
    key: 'demo-pan-002',
    name: 'Example Panstar B',
    status: 'READY',
    minutesStale: 4,
    cpu: false,
    memory: [null, 0.5 * GB],
    disk: [null, 5 * GB],
    network: false,
    traffic: 'quota',
    metadata: { plan: { name: 'Example Nano B', cpu: 1 }, os: 'debian 12', expires_at: '2030-03-01T00:00:00Z' },
  },
  {
    provider: 'dedione',
    key: 'demo-vz-001',
    name: 'Example Virtualizor A',
    status: 'running',
    minutesStale: 6,
    cpu: true,
    memory: [0.86 * GB, 1 * GB],
    disk: [8.6 * GB, 20 * GB],
    network: false,
    traffic: 'used-only',
    metadata: { os: 'ubuntu-22.04-x86_64' },
  },
  {
    provider: 'dedione',
    key: 'demo-vz-002',
    name: 'Example Virtualizor B',
    status: 'stopped',
    minutesStale: 42,
    cpu: false,
    memory: null,
    disk: null,
    network: false,
    traffic: 'none',
    metadata: { os: 'debian-12' },
  },
]

/** 稳定伪随机：同一个实例在同一分钟得到同一组数值。 */
function noise(seed: number): number {
  const value = Math.sin(seed) * 10_000
  return value - Math.floor(value)
}

function hash(text: string): number {
  let result = 0
  for (let index = 0; index < text.length; index += 1) {
    result = (result * 31 + text.charCodeAt(index)) % 100_000
  }
  return result
}

function metricsFor(instance: MockInstance, tick: number): Record<string, number> {
  const seed = hash(instance.key) + tick
  const metrics: Record<string, number> = {}
  if (instance.cpu) metrics['cpu_percent'] = Number((2 + noise(seed) * 28).toFixed(3))
  if (instance.memory) {
    const [used, total] = instance.memory
    metrics['memory_total_bytes'] = total
    if (used !== null) metrics['memory_used_bytes'] = Math.round(used * (0.9 + noise(seed + 1) * 0.2))
  }
  if (instance.disk) {
    const [used, total] = instance.disk
    metrics['disk_total_bytes'] = total
    if (used !== null) metrics['disk_used_bytes'] = Math.round(used * (0.98 + noise(seed + 2) * 0.04))
  }
  if (instance.network) {
    metrics['network_in_bps'] = Math.round(20_000 + noise(seed + 3) * 400_000)
    metrics['network_out_bps'] = Math.round(15_000 + noise(seed + 4) * 300_000)
    metrics['disk_read_iops'] = Number((noise(seed + 5) * 3).toFixed(3))
    metrics['disk_write_iops'] = Number((noise(seed + 6) * 6).toFixed(3))
  }
  return metrics
}

function quotaFor(instance: MockInstance, tick: number): Record<string, number | boolean | string> {
  const seed = hash(instance.key) + tick
  switch (instance.traffic) {
    case 'unlimited':
      return { traffic_unlimited: true, traffic_billing_mode: 'bandwidth' }
    case 'used-only':
      return { traffic_used_bytes: Math.round(11 * GB + tick * 4 * 1024 * 1024) }
    case 'quota': {
      const total = 512 * GB
      const ratio = instance.key === 'demo-pan-002' ? 0.86 : 0.12
      const used = Math.round(total * ratio + tick * 8 * 1024 * 1024 + noise(seed) * 1024 * 1024)
      return {
        traffic_used_bytes: used,
        traffic_total_bytes: total,
        traffic_remaining_bytes: Math.max(0, total - used),
        traffic_in_bytes: Math.round(used * 0.2),
        traffic_out_bytes: Math.round(used * 0.8),
        traffic_reset_at: new Date(Date.now() + 9 * 86_400_000).toISOString(),
      }
    }
    default:
      return {}
  }
}

function observedAt(instance: MockInstance, offsetMinutes = 0): string {
  return new Date(Date.now() - (instance.minutesStale + offsetMinutes) * 60_000).toISOString()
}

function instancePayload(instance: MockInstance) {
  return {
    provider: instance.provider,
    instance_key: instance.key,
    display_name: instance.name,
    observed_at: observedAt(instance),
    status: instance.status,
    metrics: metricsFor(instance, 0),
    quota: quotaFor(instance, 0),
    metadata: instance.metadata,
  }
}

function historyPayload(instance: MockInstance, hours: number) {
  const step = hours <= 24 ? 5 : hours <= 168 ? 30 : 120
  const count = Math.floor((hours * 60) / step)
  const points = []
  for (let index = count; index >= 0; index -= 1) {
    points.push({
      observed_at: observedAt(instance, index * step),
      status: instance.status,
      metrics: metricsFor(instance, -index),
      quota: quotaFor(instance, -index),
    })
  }
  return { provider: instance.provider, instance_key: instance.key, hours, points }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function handle(url: URL): Response | undefined {
  const path = url.pathname

  if (path === '/health') {
    return json({
      status: 'ok',
      database: 'ok',
      latest_observation_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    })
  }

  if (path === '/api/v1/providers') {
    return json({
      items: PROVIDERS.map((provider) => ({
        provider: provider.id,
        ok: provider.ok,
        instance_count: INSTANCES.filter((item) => item.provider === provider.id).length,
        last_collected_at: new Date(Date.now() - 3 * 60_000).toISOString(),
        last_error: provider.error,
      })),
    })
  }

  if (path === '/api/v1/summary') {
    const online = INSTANCES.filter((item) =>
      ['running', 'ready'].includes(item.status.toLowerCase()),
    ).length
    const withQuota = INSTANCES.filter((item) => item.traffic === 'quota')
    return json({
      generated_at: new Date().toISOString(),
      providers_total: PROVIDERS.length,
      providers_ok: PROVIDERS.filter((item) => item.ok).length,
      instances_total: INSTANCES.length,
      instances_online: online,
      instances_unlimited_traffic: INSTANCES.filter((item) => item.traffic === 'unlimited').length,
      traffic_used_bytes: withQuota.reduce(
        (sum, item) => sum + Number(quotaFor(item, 0)['traffic_used_bytes'] ?? 0),
        0,
      ),
      traffic_total_bytes: withQuota.length * 512 * GB,
    })
  }

  if (path === '/api/v1/live/aliyun_swas') {
    const now = new Date().toISOString()
    const items = INSTANCES.filter((item) => item.provider === 'aliyun_swas').map((item) => ({
      ...instancePayload(item),
      observed_at: now,
    }))
    return json({
      provider: 'aliyun_swas',
      requested_at: now,
      completed_at: now,
      duration_ms: 180,
      total: items.length,
      items,
    })
  }

  if (path === '/api/v1/instances') {
    const provider = url.searchParams.get('provider')
    const search = url.searchParams.get('search')?.toLowerCase()
    let items = INSTANCES
    if (provider) items = items.filter((item) => item.provider === provider)
    if (search) {
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(search) || item.key.toLowerCase().includes(search),
      )
    }
    return json({
      total: items.length,
      offset: 0,
      limit: items.length,
      items: items.map(instancePayload),
    })
  }

  const match = /^\/api\/v1\/instances\/([^/]+)\/([^/]+)(\/history)?$/.exec(path)
  if (match) {
    const [, provider, key, isHistory] = match
    const instance = INSTANCES.find(
      (item) => item.provider === provider && item.key === decodeURIComponent(key ?? ''),
    )
    if (!instance) return json({ detail: '实例不存在' }, 404)
    if (isHistory) {
      return json(historyPayload(instance, Number(url.searchParams.get('hours') ?? 24)))
    }
    return json(instancePayload(instance))
  }

  return undefined
}

export function installMockApi(): void {
  if (!import.meta.env.DEV) return
  if (import.meta.env.VITE_USE_MOCK !== '1') return

  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (raw.startsWith(apiBaseUrl)) {
      const response = handle(new URL(raw))
      if (response) {
        // 模拟一点点网络延迟，便于观察骨架屏。
        await new Promise((resolve) => setTimeout(resolve, 180))
        return response
      }
    }
    return original(input, init)
  }

  console.info('[vpsmonitor] 已启用开发期 mock 数据（VITE_USE_MOCK=1）')
}
