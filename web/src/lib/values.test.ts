import { describe, expect, it } from 'vitest'

import {
  clampPercent,
  ratioToPercent,
  readBoolean,
  readNumber,
  readPathNumber,
  readPathText,
  readText,
  toNumber,
} from '@/lib/values'

describe('toNumber', () => {
  it('接受数字与数字字符串', () => {
    expect(toNumber(12)).toBe(12)
    expect(toNumber('12.5')).toBe(12.5)
    expect(toNumber(0)).toBe(0)
  })

  it('拒绝布尔值，避免 traffic_unlimited=true 被当成 1', () => {
    expect(toNumber(true)).toBeUndefined()
    expect(toNumber(false)).toBeUndefined()
  })

  it('拒绝空串、null 与非数字', () => {
    expect(toNumber('')).toBeUndefined()
    expect(toNumber('   ')).toBeUndefined()
    expect(toNumber(null)).toBeUndefined()
    expect(toNumber(undefined)).toBeUndefined()
    expect(toNumber('abc')).toBeUndefined()
    expect(toNumber(Number.NaN)).toBeUndefined()
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})

describe('readNumber', () => {
  it('按顺序回退到别名字段', () => {
    expect(readNumber({ traffic_rx_bytes: 100 }, 'traffic_in_bytes', 'traffic_rx_bytes')).toBe(100)
    expect(readNumber({ traffic_in_bytes: 50, traffic_rx_bytes: 100 }, 'traffic_in_bytes', 'traffic_rx_bytes')).toBe(50)
  })

  it('字段缺失返回 undefined 而不是 0', () => {
    expect(readNumber({}, 'cpu_percent')).toBeUndefined()
    expect(readNumber(undefined, 'cpu_percent')).toBeUndefined()
    expect(readNumber({ cpu_percent: null }, 'cpu_percent')).toBeUndefined()
  })
})

describe('readBoolean', () => {
  it('识别布尔与字符串布尔', () => {
    expect(readBoolean({ traffic_unlimited: true }, 'traffic_unlimited')).toBe(true)
    expect(readBoolean({ traffic_unlimited: 'false' }, 'traffic_unlimited')).toBe(false)
    expect(readBoolean({}, 'traffic_unlimited')).toBeUndefined()
  })
})

describe('readText', () => {
  it('跳过空串并支持数字转文本', () => {
    expect(readText({ region: '  cn-hangzhou ' }, 'region')).toBe('cn-hangzhou')
    expect(readText({ region: '' }, 'region', 'region_id')).toBeUndefined()
    expect(readText({ cpu: 2 }, 'cpu')).toBe('2')
  })
})

describe('readPath', () => {
  const metadata = { plan: { name: 'Example Nano Plan', cpu: 1 }, ip: { s1: '192.0.2.10' } }

  it('读取嵌套字段', () => {
    expect(readPathText(metadata, ['plan', 'name'])).toBe('Example Nano Plan')
    expect(readPathNumber(metadata, ['plan', 'cpu'])).toBe(1)
  })

  it('路径不存在或类型不符时返回 undefined', () => {
    expect(readPathText(metadata, ['plan', 'missing'])).toBeUndefined()
    expect(readPathText(metadata, ['ip'])).toBeUndefined()
    expect(readPathNumber(undefined, ['plan', 'cpu'])).toBeUndefined()
  })
})

describe('ratioToPercent', () => {
  it('计算百分比并裁剪到 0–100', () => {
    expect(ratioToPercent(50, 200)).toBe(25)
    expect(ratioToPercent(300, 200)).toBe(100)
    expect(clampPercent(-5)).toBe(0)
  })

  it('缺失或零分母返回 undefined', () => {
    expect(ratioToPercent(undefined, 200)).toBeUndefined()
    expect(ratioToPercent(50, undefined)).toBeUndefined()
    expect(ratioToPercent(50, 0)).toBeUndefined()
  })
})
