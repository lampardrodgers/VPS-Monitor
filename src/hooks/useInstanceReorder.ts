import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { DropPosition } from '@/lib/list'

interface DropTarget {
  id: string
  position: DropPosition
}

function targetAt(activeId: string, clientX: number, clientY: number): DropTarget | null {
  const element = document.elementFromPoint(clientX, clientY)
  const target = element?.closest<HTMLElement>('[data-reorder-id]')
  const id = target?.dataset['reorderId']
  if (!target || !id || id === activeId) return null

  const bounds = target.getBoundingClientRect()
  if (target.dataset['reorderLayout'] === 'cards') {
    const yOffset = clientY - (bounds.top + bounds.height / 2)
    const xOffset = clientX - (bounds.left + bounds.width / 2)
    if (Math.abs(yOffset) <= bounds.height * 0.2) {
      return { id, position: xOffset < 0 ? 'before' : 'after' }
    }
    return { id, position: yOffset < 0 ? 'before' : 'after' }
  }
  return { id, position: clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' }
}

export function useInstanceReorder(
  onReorder: (activeId: string, targetId: string, position: DropPosition) => void,
) {
  const onReorderRef = useRef(onReorder)
  const activeRef = useRef<string | null>(null)
  const lastAppliedTargetRef = useRef<string | null>(null)
  const removeWindowListenersRef = useRef<(() => void) | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  onReorderRef.current = onReorder

  const clear = () => {
    removeWindowListenersRef.current?.()
    removeWindowListenersRef.current = null
    activeRef.current = null
    lastAppliedTargetRef.current = null
    setDraggingId(null)
    setDropTarget(null)
  }

  useEffect(() => () => removeWindowListenersRef.current?.(), [])

  const move = (clientX: number, clientY: number) => {
    const activeId = activeRef.current
    if (!activeId) return

    const target = targetAt(activeId, clientX, clientY)
    setDropTarget(target)
    if (!target) return

    const signature = `${target.id}:${target.position}`
    if (signature === lastAppliedTargetRef.current) return
    lastAppliedTargetRef.current = signature
    onReorderRef.current(activeId, target.id, target.position)
  }

  const start = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    clear()
    activeRef.current = id
    setDraggingId(id)

    const handleMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault()
      move(pointerEvent.clientX, pointerEvent.clientY)
    }
    const handleEnd = () => clear()
    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', handleEnd)
    window.addEventListener('pointercancel', handleEnd)
    removeWindowListenersRef.current = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleEnd)
      window.removeEventListener('pointercancel', handleEnd)
    }
  }

  return {
    draggingId,
    dropTarget,
    pointerHandlers: {
      onPointerDown: start,
    },
  }
}
