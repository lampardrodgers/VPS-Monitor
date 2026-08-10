/**
 * `metrics` / `quota` / `metadata` 的安全读取。
 *
 * 铁律：字段缺失 = 不支持或没有数据，绝不能退化成 0。所有读取函数在读不到时
 * 返回 `undefined`，由 UI 决定显示“—”还是“不支持”。
 */
import type { MetadataMap, MetricMap, MetricValue } from '@/api/types'

export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  // 布尔量不是数值：traffic_unlimited=true 不能被当成 1。
  return undefined
}

/** 按优先级读取第一个存在的数值字段（用于 in/out 与 rx/tx 这类别名）。 */
export function readNumber(
  source: MetricMap | undefined,
  ...keys: string[]
): number | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = toNumber(source[key])
    if (value !== undefined) return value
  }
  return undefined
}

export function readBoolean(source: MetricMap | undefined, key: string): boolean | undefined {
  const value = source?.[key]
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export function readText(
  source: MetricMap | MetadataMap | undefined,
  ...keys: string[]
): string | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

/** metadata 里可能嵌套对象（例如 panstar 的 plan），按路径安全取值。 */
export function readPath(source: MetadataMap | undefined, path: string[]): unknown {
  let current: unknown = source
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function readPathText(source: MetadataMap | undefined, path: string[]): string | undefined {
  const value = readPath(source, path)
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export function readPathNumber(source: MetadataMap | undefined, path: string[]): number | undefined {
  return toNumber(readPath(source, path))
}

/** 百分比：0–100，超出范围会被裁剪，避免进度条溢出。 */
export function ratioToPercent(used?: number, total?: number): number | undefined {
  if (used === undefined || total === undefined || total <= 0) return undefined
  return clampPercent((used / total) * 100)
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export function isMetricPresent(value: MetricValue | undefined): boolean {
  return value !== undefined && value !== null
}
