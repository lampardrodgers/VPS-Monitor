import { useCallback, useEffect, useMemo, useState } from 'react'

import type { InstanceRef } from '@/api/types'
import { parseTimestamp } from '@/lib/format'
import {
  advanceMonthlyReset,
  manualResetAnchorDayStorageKey,
  manualResetAutoAdvanceStorageKey,
  manualResetStorageKey,
} from '@/lib/manualReset'
import { readStoredValue, removeStored, writeStored } from '@/lib/storage'

interface ManualResetSchedule {
  value: string | undefined
  autoAdvance: boolean
  anchorDay: number | undefined
}

function readSchedule(ref: InstanceRef): ManualResetSchedule {
  const value = readStoredValue(manualResetStorageKey(ref))
  const parsedValue = parseTimestamp(value) === undefined ? undefined : value
  const rawAnchorDay = Number(readStoredValue(manualResetAnchorDayStorageKey(ref)))
  const anchorDay =
    Number.isInteger(rawAnchorDay) && rawAnchorDay >= 1 && rawAnchorDay <= 31
      ? rawAnchorDay
      : parsedValue
        ? new Date(parsedValue).getDate()
        : undefined
  return {
    value: parsedValue,
    autoAdvance:
      parsedValue !== undefined &&
      readStoredValue(manualResetAutoAdvanceStorageKey(ref)) === 'true',
    anchorDay,
  }
}

export function useManualTrafficReset(ref: InstanceRef, now: number) {
  const resetKey = manualResetStorageKey(ref)
  const autoAdvanceKey = manualResetAutoAdvanceStorageKey(ref)
  const anchorDayKey = manualResetAnchorDayStorageKey(ref)
  const [revision, setRevision] = useState(0)
  const schedule = useMemo(
    () => readSchedule(ref),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision 用于本地存储写入后主动重读。
    [resetKey, autoAdvanceKey, anchorDayKey, revision],
  )

  useEffect(() => {
    if (!schedule.value || !schedule.autoAdvance) return
    const advanced = advanceMonthlyReset(schedule.value, now, schedule.anchorDay)
    if (!advanced || advanced === schedule.value) return
    writeStored(resetKey, advanced)
    setRevision((current) => current + 1)
  }, [anchorDayKey, autoAdvanceKey, now, resetKey, schedule])

  const save = useCallback(
    (next: string, autoAdvance: boolean) => {
      writeStored(resetKey, next)
      writeStored(autoAdvanceKey, String(autoAdvance))
      writeStored(anchorDayKey, new Date(next).getDate())
      setRevision((current) => current + 1)
    },
    [anchorDayKey, autoAdvanceKey, resetKey],
  )

  const setAutoAdvance = useCallback(
    (enabled: boolean) => {
      writeStored(autoAdvanceKey, String(enabled))
      if (schedule.value && schedule.anchorDay === undefined) {
        writeStored(anchorDayKey, new Date(schedule.value).getDate())
      }
      setRevision((current) => current + 1)
    },
    [anchorDayKey, autoAdvanceKey, schedule.anchorDay, schedule.value],
  )

  const clear = useCallback(() => {
    removeStored(resetKey)
    removeStored(autoAdvanceKey)
    removeStored(anchorDayKey)
    setRevision((current) => current + 1)
  }, [anchorDayKey, autoAdvanceKey, resetKey])

  return { ...schedule, save, clear, setAutoAdvance }
}
