/**
 * 供应商展示信息。
 *
 * 扩展方式：后端新增供应商后前端**不需要**改动——未知 provider 会自动得到
 * 可读名称和稳定色相。只有想自定义中文名或配色时，才往 `PROVIDER_REGISTRY` 加一行。
 */

export interface ProviderMeta {
  id: string
  label: string
  /** 表格里显示的短标签，保持 2–4 个字符宽度对齐。 */
  short: string
  hue: number
}

const PROVIDER_REGISTRY: Record<string, Omit<ProviderMeta, 'id'>> = {
  bandwagon: { label: 'BandwagonHost', short: 'BWH', hue: 250 },
  aliyun_swas: { label: '阿里云 SWAS', short: 'ALI', hue: 30 },
  panstar: { label: 'PanstarCloud', short: 'PAN', hue: 200 },
  greencloud: { label: 'GreenCloud', short: 'GC', hue: 150 },
  dedione: { label: 'DediOne', short: 'D1', hue: 320 },
  virtualizor: { label: 'Virtualizor', short: 'VIR', hue: 90 },
  virtfusion: { label: 'VirtFusion', short: 'VF', hue: 120 },
}

/** 稳定散列：同一个 provider 每次刷新都得到同一个色相。 */
function hashHue(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 360
  }
  return hash
}

function humanize(id: string): string {
  return id
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ')
}

export function providerMeta(id: string): ProviderMeta {
  const known = PROVIDER_REGISTRY[id]
  if (known) return { id, ...known }
  const label = humanize(id)
  return {
    id,
    label,
    short: label.replace(/[^A-Za-z0-9一-龥]/g, '').slice(0, 3).toUpperCase() || '—',
    hue: hashHue(id),
  }
}

/** 色相 → 主题自适应色值（亮度/饱和度由 CSS 变量控制）。 */
export function providerColor(id: string): string {
  return `oklch(var(--tint-l) var(--tint-c) ${providerMeta(id).hue})`
}

export function providerTintBackground(id: string): string {
  return `oklch(var(--tint-l) var(--tint-c) ${providerMeta(id).hue} / 0.14)`
}
