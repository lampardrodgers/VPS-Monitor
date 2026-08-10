import type { Theme } from '@/hooks/preferences'

/** Recharts 需要具体色值，这里按主题给出与 CSS 变量一致的一套。 */
export interface ChartTheme {
  grid: string
  axis: string
  tooltipBg: string
  tooltipBorder: string
  series: [string, string, string, string]
  reference: string
}

const DARK: ChartTheme = {
  grid: 'rgba(148, 178, 214, 0.12)',
  axis: '#6a7a8c',
  tooltipBg: 'rgba(14, 20, 28, 0.96)',
  tooltipBorder: '#2c3b4b',
  series: ['#3fb6f0', '#a78bfa', '#37d3a6', '#eab543'],
  reference: 'rgba(148, 178, 214, 0.35)',
}

const LIGHT: ChartTheme = {
  grid: 'rgba(15, 23, 42, 0.09)',
  axis: '#7b8794',
  tooltipBg: 'rgba(255, 255, 255, 0.98)',
  tooltipBorder: '#c3ccd8',
  series: ['#0b74c4', '#7a5af8', '#0f8f78', '#b4690e'],
  reference: 'rgba(15, 23, 42, 0.3)',
}

export function chartTheme(theme: Theme): ChartTheme {
  return theme === 'dark' ? DARK : LIGHT
}
