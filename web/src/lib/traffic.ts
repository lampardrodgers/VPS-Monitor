/**
 * 流量模型。四种互斥形态，界面按形态渲染，避免把“无限流量”画成 0% 或 100%。
 */
import type { MetricMap } from '@/api/types'
import { readBoolean, readNumber, readText, ratioToPercent } from '@/lib/values'
import { usageTone, type Tone } from '@/lib/status'

export interface TrafficDirections {
  inBytes: number | undefined
  outBytes: number | undefined
}

/**
 * `declared`：供应商明确返回 `traffic_unlimited=true`（例如阿里云带宽型）。
 * `inferred`：只给了已用量、没有任何配额字段（例如 DediOne），按无限流量处理。
 */
export type UnlimitedSource = 'declared' | 'inferred'

export type TrafficModel =
  | ({
      kind: 'unlimited'
      source: UnlimitedSource
      billingMode: string | undefined
      used: number | undefined
      resetAt: string | undefined
    } & TrafficDirections)
  | ({
      kind: 'quota'
      used: number
      total: number
      remaining: number
      percent: number
      tone: Tone
      resetAt: string | undefined
    } & TrafficDirections)
  | { kind: 'none' }

/** 与 CPU / 内存 / 磁盘共用同一套阈值，界面上所有进度条的配色规则一致。 */
export function trafficTone(percent: number): Tone {
  return usageTone(percent)
}

export function describeTraffic(quota: MetricMap | undefined): TrafficModel {
  const directions: TrafficDirections = {
    inBytes: readNumber(quota, 'traffic_in_bytes', 'traffic_rx_bytes'),
    outBytes: readNumber(quota, 'traffic_out_bytes', 'traffic_tx_bytes'),
  }
  const resetAt = readText(quota, 'traffic_reset_at')
  const used = readNumber(quota, 'traffic_used_bytes')
  const total = readNumber(quota, 'traffic_total_bytes')
  const remaining = readNumber(quota, 'traffic_remaining_bytes')

  if (readBoolean(quota, 'traffic_unlimited') === true) {
    return {
      kind: 'unlimited',
      source: 'declared',
      billingMode: readText(quota, 'traffic_billing_mode'),
      used,
      resetAt,
      ...directions,
    }
  }

  if (total !== undefined && total > 0) {
    // 已用量缺失但给了剩余量时可以反推，两者都没有才算异常。
    const usedBytes = used ?? (remaining !== undefined ? Math.max(0, total - remaining) : undefined)
    if (usedBytes !== undefined) {
      const percent = ratioToPercent(usedBytes, total) ?? 0
      return {
        kind: 'quota',
        used: usedBytes,
        total,
        remaining: remaining ?? Math.max(0, total - usedBytes),
        percent,
        tone: trafficTone(percent),
        resetAt,
        ...directions,
      }
    }
  }

  // 只有已用量、完全没有配额字段：这类套餐（DediOne 等）实际就是不限流量，
  // 按无限流量展示，但保留真实用量，并标明是推断出来的。
  if (used !== undefined) {
    return {
      kind: 'unlimited',
      source: 'inferred',
      billingMode: readText(quota, 'traffic_billing_mode'),
      used,
      resetAt,
      ...directions,
    }
  }

  return { kind: 'none' }
}

/** 排序用的可比数值：只有固定配额的实例参与百分比排序，其余沉底。 */
export function trafficSortValue(model: TrafficModel): number | undefined {
  return model.kind === 'quota' ? model.percent : undefined
}

export function isUnlimited(model: TrafficModel): boolean {
  return model.kind === 'unlimited'
}
