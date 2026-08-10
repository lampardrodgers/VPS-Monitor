/**
 * 用户偏好：主题、轮询间隔、列表视图、每页条数。全部持久化到 localStorage。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { readStored, readStoredNumber, writeStored } from '@/lib/storage'

export type Theme = 'dark' | 'light'
export type ViewMode = 'table' | 'cards'

/** 默认 5 分钟；同一个选项控制阿里云实时查询和其他只读接口的刷新。 */
export const REFRESH_OPTIONS = [
  { value: 30_000, label: '30 秒' },
  { value: 60_000, label: '1 分钟' },
  { value: 300_000, label: '5 分钟' },
  { value: 0, label: '关闭' },
] as const

export const DEFAULT_REFRESH_MS = 300_000

const THEMES: Theme[] = ['dark', 'light']
const VIEW_MODES: ViewMode[] = ['table', 'cards']
const PAGE_SIZE_VALUES = [10, 25, 50, 100]
const REFRESH_VALUES = REFRESH_OPTIONS.map((option) => option.value as number)

interface PreferencesValue {
  theme: Theme
  toggleTheme: () => void
  refreshMs: number
  setRefreshMs: (value: number) => void
  /** TanStack Query 需要 `false` 表示不轮询。 */
  refetchInterval: number | false
  viewMode: ViewMode
  setViewMode: (value: ViewMode) => void
  pageSize: number
  setPageSize: (value: number) => void
}

const PreferencesContext = createContext<PreferencesValue | null>(null)

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readStored('theme', THEMES) ?? 'dark')
  const [refreshMs, setRefreshMsState] = useState<number>(
    () => readStoredNumber('refresh', REFRESH_VALUES) ?? DEFAULT_REFRESH_MS,
  )
  const [viewMode, setViewModeState] = useState<ViewMode>(
    () => readStored('view', VIEW_MODES) ?? 'table',
  )
  const [pageSize, setPageSizeState] = useState<number>(
    () => readStoredNumber('pageSize', PAGE_SIZE_VALUES) ?? 25,
  )

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      writeStored('theme', next)
      return next
    })
  }, [])

  const setRefreshMs = useCallback((value: number) => {
    setRefreshMsState(value)
    writeStored('refresh', value)
  }, [])

  const setViewMode = useCallback((value: ViewMode) => {
    setViewModeState(value)
    writeStored('view', value)
  }, [])

  const setPageSize = useCallback((value: number) => {
    setPageSizeState(value)
    writeStored('pageSize', value)
  }, [])

  const value = useMemo<PreferencesValue>(
    () => ({
      theme,
      toggleTheme,
      refreshMs,
      setRefreshMs,
      refetchInterval: refreshMs > 0 ? refreshMs : false,
      viewMode,
      setViewMode,
      pageSize,
      setPageSize,
    }),
    [theme, toggleTheme, refreshMs, setRefreshMs, viewMode, setViewMode, pageSize, setPageSize],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences 必须在 PreferencesProvider 内使用')
  return value
}
