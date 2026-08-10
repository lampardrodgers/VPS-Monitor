import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/errors'
import {
  parseHealth,
  parseHistory,
  parseInstance,
  parseInstanceList,
  parseLiveQuery,
  parseProviderList,
  parseSummary,
} from '@/api/parse'

const INSTANCE = {
  provider: 'example_provider',
  instance_key: 'demo-instance-001',
  display_name: 'Example VPS',
  observed_at: '2030-01-01T00:00:00+00:00',
  status: 'READY',
  metrics: { memory_total_bytes: 536_870_912, unsupported: { nested: true } },
  quota: { traffic_unlimited: false, traffic_used_bytes: 1 },
  metadata: { plan: { name: 'Example Plan' } },
}

describe('parseHealth', () => {
  it('parses a valid response', () => {
    expect(
      parseHealth({
        status: 'ok',
        database: 'ok',
        latest_observation_at: '2030-01-01T00:00:00+00:00',
      }),
    ).toEqual({
      status: 'ok',
      database: 'ok',
      latest_observation_at: '2030-01-01T00:00:00+00:00',
    })
  })

  it('accepts a null latest observation', () => {
    expect(parseHealth({ status: 'ok', database: 'ok', latest_observation_at: null })).toEqual({
      status: 'ok',
      database: 'ok',
      latest_observation_at: null,
    })
  })

  it('rejects invalid structures', () => {
    expect(() => parseHealth(null)).toThrow(ApiError)
    expect(() => parseHealth({ database: 'ok' })).toThrow(ApiError)
  })
})

describe('parseProviderList', () => {
  it('keeps errors and supplies optional defaults', () => {
    const result = parseProviderList({
      items: [
        {
          provider: 'example_provider',
          ok: false,
          instance_count: 0,
          last_collected_at: '2030-01-01T00:00:00+00:00',
          last_error: 'Example provider error',
        },
        { provider: 'another_provider', ok: true },
      ],
    })
    expect(result.items[0]?.last_error).toBe('Example provider error')
    expect(result.items[1]).toMatchObject({
      instance_count: 0,
      last_collected_at: '',
      last_error: null,
    })
  })

  it('rejects non-array items', () => {
    expect(() => parseProviderList({ items: {} })).toThrow(ApiError)
  })
})

describe('parseInstance', () => {
  it('keeps scalar metrics and nested metadata', () => {
    const instance = parseInstance(INSTANCE)
    expect(instance.metrics).toEqual({ memory_total_bytes: 536_870_912 })
    expect(instance.quota).toEqual({ traffic_unlimited: false, traffic_used_bytes: 1 })
    expect(instance.metadata).toEqual({ plan: { name: 'Example Plan' } })
  })

  it('normalizes missing optional fields', () => {
    expect(parseInstance({ ...INSTANCE, status: undefined }).status).toBeNull()
    expect(parseInstance({ ...INSTANCE, display_name: undefined }).display_name).toBe(
      'demo-instance-001',
    )
  })

  it('rejects missing required fields', () => {
    expect(() => parseInstance({ provider: 'example_provider' })).toThrow(ApiError)
  })
})

describe('parseInstanceList', () => {
  it('uses item counts when pagination fields are absent', () => {
    const list = parseInstanceList({ items: [INSTANCE] })
    expect(list).toMatchObject({ total: 1, offset: 0, limit: 1 })
    expect(list.items[0]?.instance_key).toBe('demo-instance-001')
  })
})

describe('parseLiveQuery', () => {
  it('parses the documented Aliyun live shape', () => {
    const live = parseLiveQuery({
      provider: 'aliyun_swas',
      requested_at: '2030-01-01T00:00:00+00:00',
      completed_at: '2030-01-01T00:00:01+00:00',
      duration_ms: 1000,
      total: 1,
      items: [{ ...INSTANCE, provider: 'aliyun_swas' }],
    })
    expect(live.total).toBe(1)
    expect(live.items[0]?.provider).toBe('aliyun_swas')
  })

  it('rejects an unexpected live provider', () => {
    expect(() =>
      parseLiveQuery({
        provider: 'example_provider',
        requested_at: '2030-01-01T00:00:00+00:00',
        completed_at: '2030-01-01T00:00:01+00:00',
        duration_ms: 1000,
        total: 0,
        items: [],
      }),
    ).toThrow(ApiError)
  })
})

describe('parseHistory', () => {
  it('parses history points', () => {
    const history = parseHistory({
      provider: 'example_provider',
      instance_key: 'demo-instance-001',
      hours: 24,
      points: [
        {
          observed_at: '2030-01-01T00:00:00+00:00',
          status: 'Running',
          metrics: { cpu_percent: 6.2 },
          quota: { traffic_unlimited: true },
        },
      ],
    })
    expect(history.points).toHaveLength(1)
    expect(history.points[0]?.metrics['cpu_percent']).toBe(6.2)
  })
})

describe('parseSummary', () => {
  it('parses all numeric counters', () => {
    const summary = parseSummary({
      generated_at: '2030-01-01T00:00:00+00:00',
      providers_total: 5,
      providers_ok: 4,
      instances_total: 6,
      instances_online: 5,
      instances_unlimited_traffic: 1,
      traffic_used_bytes: 100,
      traffic_total_bytes: 200,
    })
    expect(summary.instances_total).toBe(6)
    expect(summary.traffic_total_bytes).toBe(200)
  })
})
