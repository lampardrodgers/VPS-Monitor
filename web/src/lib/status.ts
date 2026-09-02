/**
 * 各家供应商的状态字符串完全不统一：`Running` / `running` / `READY` / `1` / `unknown`。
 * 这里归一到四种语气，新增供应商时只需要往下面的集合里补词，界面不用改。
 */

export type Tone = 'ok' | 'warn' | 'crit' | 'muted'

export interface StatusInfo {
  /** 供应商原始状态，界面照原样展示，便于排查。 */
  raw: string | null
  /** 归一后的分组，用于筛选。 */
  group: 'online' | 'offline' | 'transitional' | 'unknown'
  tone: Tone
  label: string
}

const ONLINE = new Set(['running', 'ready', 'online', 'active', 'up', 'started', '1', 'poweron'])

const OFFLINE = new Set([
  '0',
  'stopped',
  'offline',
  'shutdown',
  'poweroff',
  'halted',
  'down',
  'suspended',
  'terminated',
  'expired',
  'deleted',
  'error',
  'failed',
])

const TRANSITIONAL = new Set([
  'starting',
  'stopping',
  'pending',
  'rebooting',
  'restarting',
  'building',
  'installing',
  'resetting',
  'upgrading',
  'migrating',
])

export const STATUS_GROUP_LABEL: Record<StatusInfo['group'], string> = {
  online: '在线',
  offline: '离线',
  transitional: '变更中',
  unknown: '未知',
}

export function normalizeStatus(raw: string | null | undefined): StatusInfo {
  const text = (raw ?? '').trim()
  const key = text.toLowerCase()

  if (text === '' || key === 'unknown' || key === 'null') {
    return { raw: raw ?? null, group: 'unknown', tone: 'muted', label: '未知' }
  }
  if (ONLINE.has(key)) {
    return { raw: text, group: 'online', tone: 'ok', label: text }
  }
  if (TRANSITIONAL.has(key)) {
    return { raw: text, group: 'transitional', tone: 'warn', label: text }
  }
  if (OFFLINE.has(key)) {
    return { raw: text, group: 'offline', tone: 'crit', label: text }
  }
  // 没见过的状态：如实展示，但不假装它在线。
  return { raw: text, group: 'unknown', tone: 'muted', label: text }
}

/** 超过该时长没有新采集，就认为数据陈旧（后端 5 分钟采集一次）。 */
export const STALE_AFTER_MS = 10 * 60_000

export function isStale(observedAtMs: number | undefined, now: number = Date.now()): boolean {
  if (observedAtMs === undefined) return true
  return now - observedAtMs > STALE_AFTER_MS
}

/** 所有使用率条共用的阈值：超过 50% 转黄，超过 80% 转红。 */
export const USAGE_WARN_PERCENT = 50
export const USAGE_CRIT_PERCENT = 80

export function usageTone(percent: number | undefined): Tone {
  if (percent === undefined) return 'muted'
  if (percent >= USAGE_CRIT_PERCENT) return 'crit'
  if (percent >= USAGE_WARN_PERCENT) return 'warn'
  return 'ok'
}
