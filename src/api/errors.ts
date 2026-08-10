export type ApiErrorKind =
  /** fetch 本身失败：SSH 隧道断开或 API 未启动。 */
  | 'network'
  /** 请求超时。 */
  | 'timeout'
  /** HTTP 状态码错误。 */
  | 'http'
  /** 响应不是预期结构。 */
  | 'parse'

export interface ApiErrorInit {
  kind: ApiErrorKind
  status?: number
  detail?: string
  url?: string
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined
  readonly detail: string | undefined
  readonly url: string | undefined

  constructor(message: string, init: ApiErrorInit) {
    super(message)
    this.name = 'ApiError'
    this.kind = init.kind
    this.status = init.status
    this.detail = init.detail
    this.url = init.url
  }

  /** 这类错误重试没有意义（参数错误 / 资源不存在）。 */
  get isTerminal(): boolean {
    if (this.kind === 'parse') return true
    if (this.status === undefined) return false
    return this.status === 404 || this.status === 422 || this.status === 400
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  get isTunnelDown(): boolean {
    return this.kind === 'network' || this.kind === 'timeout'
  }

  get isDatabaseDown(): boolean {
    return this.status === 503
  }
}

/**
 * 取第一个真实存在的错误。
 *
 * TanStack Query 在重试期间只填充 `failureReason`，`error` 要等重试耗尽才有值；
 * 只看 `error` 会让隧道断开时一直停在骨架屏上，所以两者都要看。
 */
export function firstError(...candidates: unknown[]): unknown {
  return candidates.find((candidate) => candidate !== null && candidate !== undefined)
}

export function isTunnelDown(error: unknown): boolean {
  return error instanceof ApiError && error.isTunnelDown
}

/** 面向用户的中文错误文案，明确区分“隧道没连”和“API 内部出错”。 */
export function describeApiError(error: unknown): { title: string; hint: string } {
  if (!(error instanceof ApiError)) {
    return {
      title: '发生未知错误',
      hint: error instanceof Error ? error.message : String(error),
    }
  }
  if (error.kind === 'network') {
    return {
      title: 'SSH 隧道未连接或 API 未启动',
      hint: '请在终端执行 ssh -N -L 8787:127.0.0.1:18787 root@<SERVER_IP>，隧道保持运行后重试。',
    }
  }
  if (error.kind === 'timeout') {
    return {
      title: '请求超时',
      hint: 'API 没有在预期时间内响应，隧道可能已经断开或服务器负载过高。',
    }
  }
  if (error.status === 503) {
    return {
      title: '监控数据库不可用',
      hint: error.detail ?? 'API 已启动但读不到 SQLite 数据库，请检查采集服务与数据目录权限。',
    }
  }
  if (error.status === 404) {
    return { title: '资源不存在', hint: error.detail ?? '该实例可能已从监控中移除。' }
  }
  if (error.status === 422) {
    return { title: '查询参数不合法', hint: error.detail ?? '请调整筛选条件后重试。' }
  }
  if (error.kind === 'parse') {
    return { title: 'API 响应格式异常', hint: error.message }
  }
  return {
    title: `API 返回 HTTP ${error.status ?? '错误'}`,
    hint: error.detail ?? error.message,
  }
}
