import { describe, expect, it } from 'vitest'

import {
  apiCountryCode,
  countryFlag,
  filterCountryOptions,
  instanceCountryStorageKey,
  normalizeCountryCode,
} from '@/lib/country'

describe('instance country', () => {
  it('识别 API 的直接国家字段', () => {
    expect(apiCountryCode({ country_code: 'jp' })).toBe('JP')
    expect(apiCountryCode({ location: { country: 'United States' } })).toBe('US')
  })

  it('从 API 区域和节点位置识别国家代码', () => {
    expect(apiCountryCode({ region_id: 'cn-hangzhou' })).toBe('CN')
    expect(apiCountryCode({ node_location: 'US, California' })).toBe('US')
  })

  it('规范化常见代码和国家名称', () => {
    expect(normalizeCountryCode('uk')).toBe('GB')
    expect(normalizeCountryCode('香港')).toBe('HK')
    expect(normalizeCountryCode('Finland')).toBe('FI')
    expect(normalizeCountryCode('not-a-country')).toBeUndefined()
  })

  it('生成国旗 emoji', () => {
    expect(countryFlag('JP')).toBe('🇯🇵')
  })

  it('支持中文、英文和代码搜索国家', () => {
    expect(filterCountryOptions('日本').map((country) => country.code)).toContain('JP')
    expect(filterCountryOptions('finland').map((country) => country.code)).toContain('FI')
    expect(filterCountryOptions('us').map((country) => country.code)).toContain('US')
    expect(filterCountryOptions('不存在的国家')).toHaveLength(0)
  })

  it('按实例生成隔离的本地存储键', () => {
    expect(instanceCountryStorageKey({ provider: 'aliyun/swas', instanceKey: 'vm 1' })).toBe(
      'instanceCountry.aliyun%2Fswas.vm%201',
    )
  })
})
