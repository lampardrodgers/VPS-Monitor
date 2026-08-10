import { describe, expect, it } from 'vitest'

import { instanceNameStorageKey, normalizeInstanceAlias } from '@/lib/instanceName'

describe('instance display name', () => {
  it('按实例生成隔离的备注名存储键', () => {
    expect(instanceNameStorageKey({ provider: 'aliyun/swas', instanceKey: 'vm 1' })).toBe(
      'instanceName.aliyun%2Fswas.vm%201',
    )
  })

  it('清理备注名前后的空白', () => {
    expect(normalizeInstanceAlias('  香港入口机  ')).toBe('香港入口机')
  })

  it('空备注名恢复为未设置状态', () => {
    expect(normalizeInstanceAlias('   ')).toBeUndefined()
  })

  it('限制备注名长度', () => {
    expect(normalizeInstanceAlias('a'.repeat(100))).toHaveLength(80)
  })
})
