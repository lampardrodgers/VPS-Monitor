/**
 * 详情面板的选中态同步到 URL（`?provider=&instance=`），
 * 这样可以直接把某台机器的链接收藏或刷新后保持打开。
 */
import { useCallback, useEffect, useState } from 'react'

import type { InstanceRef } from '@/api/types'

function readFromLocation(): InstanceRef | null {
  const params = new URLSearchParams(window.location.search)
  const provider = params.get('provider')
  const instanceKey = params.get('instance')
  if (!provider || !instanceKey) return null
  return { provider, instanceKey }
}

function writeToLocation(ref: InstanceRef | null): void {
  const url = new URL(window.location.href)
  if (ref) {
    url.searchParams.set('provider', ref.provider)
    url.searchParams.set('instance', ref.instanceKey)
  } else {
    url.searchParams.delete('provider')
    url.searchParams.delete('instance')
  }
  window.history.pushState({}, '', url)
}

export function useSelectedInstance(): {
  selected: InstanceRef | null
  select: (ref: InstanceRef | null) => void
} {
  const [selected, setSelected] = useState<InstanceRef | null>(readFromLocation)

  useEffect(() => {
    const onPopState = () => setSelected(readFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const select = useCallback((ref: InstanceRef | null) => {
    setSelected(ref)
    writeToLocation(ref)
  }, [])

  return { selected, select }
}
