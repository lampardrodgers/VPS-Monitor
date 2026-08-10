import { describe, expect, it } from 'vitest'

import type { InstanceObservation, LiveQueryResponse } from '@/api/types'
import {
  mergeLiveInstances,
  rollupTraffic,
  toInstanceView,
  toInstanceViews,
} from '@/lib/instance'

const NOW = Date.parse('2030-01-01T00:05:00Z')

function observation(partial: Partial<InstanceObservation> = {}): InstanceObservation {
  return {
    provider: 'example_provider',
    instance_key: 'demo-instance-001',
    display_name: 'Example VPS',
    observed_at: '2030-01-01T00:00:00+00:00',
    status: 'READY',
    metrics: {},
    quota: {},
    metadata: {},
    ...partial,
  }
}

describe('toInstanceView', () => {
  it('expands metrics, traffic, and metadata', () => {
    const view = toInstanceView(
      observation({
        provider: 'aliyun_swas',
        instance_key: 'demo-swas-001',
        display_name: 'Example SWAS',
        status: 'Running',
        metrics: {
          cpu_percent: 2.985,
          memory_used_bytes: 1_104_553_984,
          memory_total_bytes: 2_147_483_648,
          disk_used_bytes: 10_413_991_936,
          disk_total_bytes: 42_949_672_960,
          network_in_bps: 29_664,
          network_out_bps: 222_512,
        },
        quota: { traffic_unlimited: true, traffic_billing_mode: 'bandwidth' },
        metadata: {
          region_id: 'example-region-1',
          plan_id: 'example.swas.plan',
          peak_bandwidth_mbps: 200,
          expires_at: '2031-01-01T00:00:00Z',
        },
      }),
      NOW,
    )

    expect(view.id).toBe('aliyun_swas/demo-swas-001')
    expect(view.provider.label).toBe('阿里云 SWAS')
    expect(view.status.kind).toBe('online')
    expect(view.cpuPercent).toBe(2.985)
    expect(view.meta.region).toBe('example-region-1')
    expect(view.meta.plan).toBe('example.swas.plan')
    expect(view.meta.bandwidthMbps).toBe(200)
    expect(view.stale).toBe(false)
  })

  it('does not invent used values when only totals exist', () => {
    const view = toInstanceView(
      observation({
        metrics: { memory_total_bytes: 536_870_912, disk_total_bytes: 10_737_418_240 },
        quota: {
          traffic_used_bytes: 580_759_857,
          traffic_total_bytes: 549_755_813_888,
          traffic_remaining_bytes: 549_175_054_031,
        },
        metadata: { plan: { name: 'Example Nano Plan', cpu: 1 }, os: 'debian 12' },
      }),
      NOW,
    )

    expect(view.memory.used).toBeUndefined()
    expect(view.memory.total).toBe(536_870_912)
    expect(view.disk.used).toBeUndefined()
    expect(view.traffic.kind).toBe('quota')
    expect(view.meta.plan).toBe('Example Nano Plan')
    expect(view.meta.cpuCores).toBe(1)
  })

  it('derives used memory from available memory', () => {
    const view = toInstanceView(
      observation({ metrics: { memory_total_bytes: 1000, memory_available_bytes: 250 } }),
      NOW,
    )
    expect(view.memory.used).toBe(750)
    expect(view.memory.percent).toBe(75)
  })

  it('marks observations older than ten minutes as stale', () => {
    const view = toInstanceView(
      observation({ observed_at: '2029-12-31T23:40:00+00:00' }),
      NOW,
    )
    expect(view.stale).toBe(true)
  })

  it('humanizes unknown providers and falls back to the instance key', () => {
    expect(toInstanceView(observation({ provider: 'new_cloud_host' }), NOW).provider.label).toBe(
      'NEW Cloud Host',
    )
    expect(
      toInstanceView(observation({ display_name: '', instance_key: 'demo-instance-002' }), NOW).name,
    ).toBe('demo-instance-002')
  })
})

describe('mergeLiveInstances', () => {
  it('replaces matching Aliyun instances and appends newly discovered ones', () => {
    const cached = [
      observation({ provider: 'aliyun_swas', instance_key: 'demo-swas-001' }),
      observation({ provider: 'example_provider', instance_key: 'demo-other-001' }),
    ]
    const live: LiveQueryResponse = {
      provider: 'aliyun_swas',
      requested_at: '2030-01-01T00:00:00+00:00',
      completed_at: '2030-01-01T00:00:01+00:00',
      duration_ms: 1000,
      total: 2,
      items: [
        observation({
          provider: 'aliyun_swas',
          instance_key: 'demo-swas-001',
          display_name: 'Updated SWAS',
        }),
        observation({ provider: 'aliyun_swas', instance_key: 'demo-swas-002' }),
      ],
    }

    const merged = mergeLiveInstances(cached, live)
    expect(merged).toHaveLength(3)
    expect(merged[0]?.display_name).toBe('Updated SWAS')
    expect(merged[1]?.provider).toBe('example_provider')
    expect(merged[2]?.instance_key).toBe('demo-swas-002')
  })
})

describe('rollupTraffic', () => {
  it('separates quota, unlimited, and unknown instances', () => {
    const views = toInstanceViews(
      [
        observation({
          instance_key: 'demo-quota',
          quota: { traffic_used_bytes: 25, traffic_total_bytes: 100 },
        }),
        observation({
          instance_key: 'demo-unlimited',
          quota: { traffic_unlimited: true },
        }),
        observation({ instance_key: 'demo-unknown' }),
      ],
      NOW,
    )
    expect(rollupTraffic(views)).toEqual({
      unlimited: 1,
      quota: 1,
      quotaUsedBytes: 25,
      quotaTotalBytes: 100,
      quotaPercent: 25,
      unknown: 1,
    })
  })
})
