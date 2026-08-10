import type { InstanceRef } from '@/api/types'
import { readStoredValue, removeStored, writeStored } from '@/lib/storage'

export function instanceNameStorageKey(ref: InstanceRef): string {
  return `instanceName.${encodeURIComponent(ref.provider)}.${encodeURIComponent(ref.instanceKey)}`
}

export function normalizeInstanceAlias(value: string): string | undefined {
  const alias = value.trim()
  return alias === '' ? undefined : alias.slice(0, 80)
}

export function readInstanceAlias(ref: InstanceRef): string | undefined {
  return normalizeInstanceAlias(readStoredValue(instanceNameStorageKey(ref)) ?? '')
}

export function writeInstanceAlias(ref: InstanceRef, value: string): string | undefined {
  const alias = normalizeInstanceAlias(value)
  if (alias) writeStored(instanceNameStorageKey(ref), alias)
  else removeStored(instanceNameStorageKey(ref))
  return alias
}

export function clearInstanceAlias(ref: InstanceRef): void {
  removeStored(instanceNameStorageKey(ref))
}
