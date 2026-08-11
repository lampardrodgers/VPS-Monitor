import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import {
  fetchAllInstances,
  fetchHealth,
  fetchHistory,
  fetchInstance,
  fetchLiveAliyun,
  fetchProviders,
  fetchRetentionSettings,
  fetchSummary,
  updateRetentionSettings,
} from './client'
import type { InstanceQuery, InstanceRef, RetentionSettingsUpdate } from './types'

export const queryKeys = {
  health: ['health'] as const,
  liveAliyun: ['live', 'aliyun_swas'] as const,
  summary: ['summary'] as const,
  providers: ['providers'] as const,
  retention: ['settings', 'retention'] as const,
  instances: (query: InstanceQuery) => ['instances', query] as const,
  instance: (ref: InstanceRef) => ['instance', ref.provider, ref.instanceKey] as const,
  history: (ref: InstanceRef, hours: number) =>
    ['history', ref.provider, ref.instanceKey, hours] as const,
}

export function useHealth(refreshMs: number | false) {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: refreshMs,
  })
}

export function useSummary(refreshMs: number | false) {
  return useQuery({
    queryKey: queryKeys.summary,
    queryFn: ({ signal }) => fetchSummary(signal),
    refetchInterval: refreshMs,
    placeholderData: keepPreviousData,
  })
}

export function useProviders(refreshMs: number | false) {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: ({ signal }) => fetchProviders(signal),
    refetchInterval: refreshMs,
    placeholderData: keepPreviousData,
  })
}

export function useRetentionSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.retention,
    queryFn: ({ signal }) => fetchRetentionSettings(signal),
    enabled,
    staleTime: 60_000,
  })
}

export function useUpdateRetentionSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (value: RetentionSettingsUpdate) => updateRetentionSettings(value),
    onSuccess: async (value) => {
      client.setQueryData(queryKeys.retention, value)
      await client.invalidateQueries({ queryKey: ['history'] })
    },
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
    refetchInterval: refreshMs,
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
