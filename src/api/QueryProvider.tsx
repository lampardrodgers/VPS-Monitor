import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { ApiError } from './errors'

/** 指数退避，上限 5 分钟：SSH 或 API 长时间不可用时不会持续打满请求。 */
export function retryDelay(attemptIndex: number): number {
  return Math.min(1_000 * 2 ** attemptIndex, 300_000)
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.isTerminal) return false
  return failureCount < 8
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay,
        staleTime: 15_000,
        gcTime: 30 * 60_000,
        // 页面失去焦点时暂停轮询，重新聚焦立刻刷新。
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        refetchOnReconnect: 'always',
      },
    },
  })
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
