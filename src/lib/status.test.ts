import { describe, expect, it } from 'vitest'

import { isStale, normalizeStatus, STALE_AFTER_MS, usageTone } from '@/lib/status'

describe('normalizeStatus', () => {
  it('把各家写法归一到在线', () => {
    for (const raw of ['running', 'Running', 'READY', 'online', '1']) {
      expect(normalizeStatus(raw).group).toBe('online')
      expect(normalizeStatus(raw).tone).toBe('ok')
    }
  })

  it('识别离线与变更中', () => {
    expect(normalizeStatus('stopped').group).toBe('offline')
    expect(normalizeStatus('stopped').tone).toBe('crit')
    expect(normalizeStatus('starting').group).toBe('transitional')
    expect(normalizeStatus('starting').tone).toBe('warn')
  })

  it('空值与未知状态不冒充在线', () => {
    expect(normalizeStatus(null).group).toBe('unknown')
    expect(normalizeStatus('').label).toBe('未知')
    expect(normalizeStatus('unknown').group).toBe('unknown')

    const custom = normalizeStatus('MIGRATING_TO_NEW_NODE')
    expect(custom.group).toBe('unknown')
    expect(custom.label).toBe('MIGRATING_TO_NEW_NODE')
  })

  it('保留供应商原始文本用于排查', () => {
    expect(normalizeStatus('READY').raw).toBe('READY')
  })
})

describe('isStale', () => {
  const now = Date.parse('2026-08-10T12:00:00Z')

  it('超过 10 分钟视为陈旧', () => {
    expect(isStale(now - 5 * 60_000, now)).toBe(false)
    expect(isStale(now - STALE_AFTER_MS - 1, now)).toBe(true)
  })

  it('没有时间戳按陈旧处理', () => {
    expect(isStale(undefined, now)).toBe(true)
  })
})

describe('usageTone', () => {
  it('50% 转黄、80% 转红', () => {
    expect(usageTone(0)).toBe('ok')
    expect(usageTone(49.9)).toBe('ok')
    expect(usageTone(50)).toBe('warn')
    expect(usageTone(79.9)).toBe('warn')
    expect(usageTone(80)).toBe('crit')
    expect(usageTone(100)).toBe('crit')
  })

  it('缺失值不参与配色', () => {
    expect(usageTone(undefined)).toBe('muted')
  })
})
