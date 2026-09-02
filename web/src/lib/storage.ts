/** localStorage 封装：隐私模式或存储被禁用时静默降级，不影响功能。 */

const PREFIX = 'vpsmon.'

export function readStored<T extends string>(key: string, allowed: readonly T[]): T | undefined {
  try {
    const value = localStorage.getItem(PREFIX + key)
    return value !== null && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : undefined
  } catch {
    return undefined
  }
}

export function readStoredNumber(key: string, allowed: readonly number[]): number | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    // 注意：Number(null) === 0，未设置过时必须先判空，否则会误命中 0（“关闭轮询”）。
    if (raw === null || raw.trim() === '') return undefined
    const value = Number(raw)
    return allowed.includes(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function readStoredValue(key: string): string | undefined {
  try {
    return localStorage.getItem(PREFIX + key) ?? undefined
  } catch {
    return undefined
  }
}

export function readStoredStringArray(key: string): string[] | undefined {
  const raw = readStoredValue(key)
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    const values = parsed.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    )
    return [...new Set(values)]
  } catch {
    return undefined
  }
}

export function writeStored(key: string, value: string | number): void {
  try {
    localStorage.setItem(PREFIX + key, String(value))
  } catch {
    // 忽略：写不进去不影响本次会话。
  }
}

export function writeStoredStringArray(key: string, values: readonly string[]): void {
  writeStored(key, JSON.stringify([...new Set(values)]))
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // 忽略：删不掉不影响本次会话。
  }
}
