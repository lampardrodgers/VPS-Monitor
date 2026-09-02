import { spawn, type ChildProcess } from 'node:child_process'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect, createServer } from 'node:net'

import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'

export interface SshOnDemandOptions {
  enabled: boolean
  target: string
  localPort: number
  remoteHost: string
  remotePort: number
  identityFile?: string
  idleMs?: number
}

interface TunnelLease {
  port: number
  release: () => void
}

const PROXY_PREFIX = '/__vpsmonitor_api'

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (connected: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(150, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

function availablePort(preferred: number): Promise<number> {
  if (preferred > 0) return Promise.resolve(preferred)
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法分配临时 SSH 端口'))
        return
      }
      const port = address.port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

class OnDemandSshTunnel {
  private tunnel: ChildProcess | undefined
  private port: number | undefined
  private starting: Promise<number> | undefined
  private leases = 0
  private stopTimer: NodeJS.Timeout | undefined
  private shuttingDown = false

  constructor(private readonly options: SshOnDemandOptions) {}

  async acquire(): Promise<TunnelLease> {
    if (this.shuttingDown) throw new Error('Web 服务正在关闭')
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = undefined
    this.leases += 1

    try {
      const port = await this.ensureStarted()
      let released = false
      return {
        port,
        release: () => {
          if (released) return
          released = true
          this.leases = Math.max(0, this.leases - 1)
          this.scheduleStop()
        },
      }
    } catch (error) {
      this.leases = Math.max(0, this.leases - 1)
      this.scheduleStop()
      throw error
    }
  }

  shutdown(): void {
    this.shuttingDown = true
    this.leases = 0
    this.stopNow()
  }

  private async ensureStarted(): Promise<number> {
    // startTunnel 会先记录子进程和端口、再等待转发真正可用。并发请求必须优先
    // 等待同一个 starting Promise，不能只看到子进程存在就提前连接该端口。
    if (this.starting) return this.starting
    if (
      this.tunnel &&
      this.tunnel.exitCode === null &&
      this.tunnel.signalCode === null &&
      this.port !== undefined
    ) {
      return this.port
    }

    const pending = this.startTunnel()
    this.starting = pending
    try {
      return await pending
    } finally {
      if (this.starting === pending) this.starting = undefined
    }
  }

  private async startTunnel(): Promise<number> {
    const port = await availablePort(this.options.localPort)
    if (this.shuttingDown) throw new Error('Web 服务正在关闭')

    const args = [
      '-N',
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ControlMaster=no',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=2',
      '-L',
      `127.0.0.1:${port}:${this.options.remoteHost}:${this.options.remotePort}`,
    ]
    if (this.options.identityFile) args.push('-i', this.options.identityFile)
    args.push(this.options.target)

    const child = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let spawnError: Error | undefined
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000)
    })
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('exit', (code, signal) => {
      if (this.tunnel !== child) return
      this.tunnel = undefined
      this.port = undefined
      if (!this.shuttingDown && this.leases > 0) {
        console.error(
          `[vpsmonitor] 临时 SSH 已退出（${signal ?? `code ${code ?? 'unknown'}`}）${stderr.trim() ? `：${stderr.trim()}` : ''}`,
        )
      }
    })
    this.tunnel = child
    this.port = port

    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) {
      if (spawnError) {
        this.stopChild(child)
        throw new Error(`无法启动 SSH：${spawnError.message}`)
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        this.stopChild(child)
        throw new Error(
          stderr.trim() ||
            `SSH 已退出（${child.signalCode ?? `code ${child.exitCode ?? 'unknown'}`}）`,
        )
      }
      if (await canConnect(port)) {
        console.info(
          `[vpsmonitor] 已建立临时 SSH：127.0.0.1:${port} → ${this.options.remoteHost}:${this.options.remotePort}`,
        )
        return port
      }
      await delay(100)
    }

    this.stopChild(child)
    throw new Error(stderr.trim() || '等待临时 SSH 转发就绪超时')
  }

  private scheduleStop(): void {
    if (this.leases > 0 || this.shuttingDown) return
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = setTimeout(() => {
      this.stopTimer = undefined
      if (this.leases === 0) this.stopNow()
    }, Math.max(100, this.options.idleMs ?? 500))
  }

  private stopChild(child: ChildProcess): void {
    if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill('SIGTERM')
    if (this.tunnel === child) {
      this.tunnel = undefined
      this.port = undefined
    }
  }

  private stopNow(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = undefined
    const child = this.tunnel
    if (!child) return
    this.stopChild(child)
    console.info('[vpsmonitor] 本轮 API 请求完成，临时 SSH 已关闭')
  }
}

function sendProxyError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined)
    return
  }
  response.statusCode = 502
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(
    JSON.stringify({
      detail: error instanceof Error ? `临时 SSH 连接失败：${error.message}` : '临时 SSH 连接失败',
    }),
  )
}

function proxyMiddleware(tunnel: OnDemandSshTunnel): Connect.NextHandleFunction {
  return (request: IncomingMessage, response: ServerResponse, next: Connect.NextFunction) => {
    const originalUrl = request.url ?? '/'
    if (originalUrl !== PROXY_PREFIX && !originalUrl.startsWith(`${PROXY_PREFIX}/`)) {
      next()
      return
    }

    void (async () => {
      let lease: TunnelLease | undefined
      try {
        lease = await tunnel.acquire()
        if (request.destroyed || response.destroyed) return

        const path = originalUrl.slice(PROXY_PREFIX.length) || '/'
        await new Promise<void>((resolve, reject) => {
          const upstream = httpRequest(
            {
              host: '127.0.0.1',
              port: lease?.port,
              method: request.method,
              path,
              headers: { ...request.headers, host: `127.0.0.1:${lease?.port ?? ''}` },
            },
            (upstreamResponse) => {
              response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
              upstreamResponse.pipe(response)
              upstreamResponse.once('end', resolve)
              upstreamResponse.once('error', reject)
            },
          )
          upstream.setTimeout(30_000, () => upstream.destroy(new Error('API 请求超时')))
          upstream.once('error', reject)
          request.once('aborted', () => upstream.destroy(new Error('浏览器已取消请求')))
          request.pipe(upstream)
        })
      } catch (error) {
        sendProxyError(response, error)
      } finally {
        lease?.release()
      }
    })()
  }
}

type SupportedServer = ViteDevServer | PreviewServer

/** 每轮 API 请求临时建立 SSH；并发请求共享，最后一个请求结束后自动关闭。 */
export function sshOnDemandPlugin(options: SshOnDemandOptions): Plugin {
  const tunnel = new OnDemandSshTunnel(options)

  const attach = (server: SupportedServer) => {
    if (!options.enabled) return
    server.middlewares.use(proxyMiddleware(tunnel))
    server.httpServer?.once('close', () => tunnel.shutdown())
  }

  return {
    name: 'vpsmonitor-ssh-on-demand',
    apply: 'serve',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

export const SSH_PROXY_PATH = PROXY_PREFIX
