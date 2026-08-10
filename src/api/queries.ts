import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import {
  fetchAllInstances,
  fetchHealth,
  fetchHistory,
  fetchInstance,
  fetchLiveAliyun,
  fetchProviders,
  fetchSummary,
} from './client'
import type { InstanceQuery, InstanceRef } from './types'

/** `/health` 固定 30 秒一次，用于判断隧道是否还活着。 */
export const HEALTH_POLL_MS = 30_000

/** 出错后（多半是隧道断了）加快探测，隧道一恢复界面就能自己回来。 */
export const RECOVERY_POLL_MS = 15_000

export const queryKeys = {
  health: ['health'] as const,
  liveAliyun: ['live', 'aliyun_swas'] as const,
  summary: ['summary'] as const,
  providers: ['providers'] as const,
  instances: (query: InstanceQuery) => ['instances', query] as const,
  instance: (ref: InstanceRef) => ['instance', ref.provider, ref.instanceKey] as const,
  history: (ref: InstanceRef, hours: number) =>
    ['history', ref.provider, ref.instanceKey, hours] as const,
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: (query) =>
      query.state.status === 'error' ? RECOVERY_POLL_MS : HEALTH_POLL_MS,
  })
}

export function useSummary(refreshMs: number | false) {
  return useQuery({
    queryKey: queryKeys.summary,
    queryFn: ({ signal }) => fetchSummary(signal),
    refetchInterval: (query) => (query.state.status === 'error' ? RECOVERY_POLL_MS : refreshMs),
    placeholderData: keepPreviousData,
  })
}

export function useProviders(refreshMs: number | false) {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: ({ signal }) => fetchProviders(signal),
    refetchInterval: (query) => (query.state.status === 'error' ? RECOVERY_POLL_MS : refreshMs),
    placeholderData: keepPreviousData,
  })
}

/**
 * 阿里云实时数据：挂载时先查一次，之后严格由界面的刷新间隔触发。
 * 单次失败不自动重试，避免一次刷新周期重复触发昂贵的供应商聚合查询。
 */
export function useLiveAliyun(refreshMs: number | false) {
  return useQuery({
    queryKey: queryKeys.liveAliyun,
    queryFn: ({ signal }) => fetchLiveAliyun(signal),
    refetchInterval: refreshMs,
    staleTime: 0,
    retry: false,
  })
}

/**
 * 服务端只负责按供应商 / 状态 / 关键字过滤，排序与分页放在客户端，
 * 这样切页和换排序不需要重新请求，也不会在刷新时闪空。
 */
export function useInstances(query: InstanceQuery, refreshMs: number | false) {
  return useQuery({
    queryKey: queryKeys.instances(query),
    queryFn: ({ signal }) => fetchAllInstances(query, signal),
    refetchInterval: (state) => (state.state.status === 'error' ? RECOVERY_POLL_MS : refreshMs),
    placeholderData: keepPreviousData,
  })
}

export function useInstance(ref: InstanceRef | null, refreshMs: number | false) {
  return useQuery({
    queryKey: ref ? queryKeys.instance(ref) : ['instance', 'none'],
    queryFn: ({ signal }) => fetchInstance(ref as InstanceRef, signal),
    enabled: ref !== null,
    refetchInterval: refreshMs,
    placeholderData: keepPreviousData,
  })
}

/** 历史只在打开详情或切换时间范围时请求，不参与常规轮询。 */
export function useInstanceHistory(
  ref: InstanceRef | null,
  range: { hours: number; limit: number },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ref ? queryKeys.history(ref, range.hours) : ['history', 'none'],
    queryFn: ({ signal }) => fetchHistory(ref as InstanceRef, range, signal),
    enabled: enabled && ref !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

/** 顶部手动刷新：让所有正在使用的查询立刻重取。 */
export function useRefreshAll(): () => Promise<void> {
  const client = useQueryClient()
  return useCallback(async () => {
    await client.invalidateQueries({ refetchType: 'active' })
  }, [client])
}
