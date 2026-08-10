import { spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

interface SshTunnelOptions {
  enabled: boolean
  target: string
  localPort: number
  remoteHost: string
  remotePort: number
  identityFile?: string
}

function readPort(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback
}

/** SSH 作为 Vite 子进程运行；Vite 关闭时同步关闭隧道，避免遗留后台进程。 */
function sshTunnelPlugin(options: SshTunnelOptions): Plugin {
  let tunnel: ChildProcess | undefined
  let stopping = false

  const stop = () => {
    stopping = true
    if (tunnel && tunnel.exitCode === null && !tunnel.killed) {
      tunnel.kill('SIGTERM')
    }
    tunnel = undefined
    process.removeListener('exit', stop)
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }

  const start = () => {
    if (!options.enabled || tunnel) return

    stopping = false
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
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
      '-L',
      `127.0.0.1:${options.localPort}:${options.remoteHost}:${options.remotePort}`,
    ]
    if (options.identityFile) args.push('-i', options.identityFile)
    args.push(options.target)

    tunnel = spawn('ssh', args, { stdio: 'inherit' })
    tunnel.once('spawn', () => {
      console.info(
        `[vpsmonitor] SSH 隧道进程已启动：127.0.0.1:${options.localPort} → ${options.remoteHost}:${options.remotePort}`,
      )
    })
    tunnel.once('error', (error) => {
      console.error(`[vpsmonitor] 无法启动 SSH：${error.message}`)
    })
    tunnel.once('exit', (code, signal) => {
      tunnel = undefined
      if (!stopping) {
        console.error(
          `[vpsmonitor] SSH 隧道已退出（${signal ?? `code ${code ?? 'unknown'}`}）。请检查 SSH Key 与服务器连接。`,
        )
      }
    })

    process.once('exit', stop)
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }

  const attach = (server: { httpServer?: { once: (event: 'close', listener: () => void) => void } | null }) => {
    start()
    server.httpServer?.once('close', stop)
  }

  return {
    name: 'vpsmonitor-ssh-tunnel',
    apply: 'serve',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

export default defineConfig(({ mode }) => {
  // 私有 SSH 配置默认放在源码目录外。项目内环境文件仍可作为显式覆盖，
  // 且未以 VITE_ 开头的变量只在 Node 侧使用，不会进入浏览器包。
  const externalConfigDir =
    process.env.VPSMON_WEB_CONFIG_DIR?.trim() ||
    join(homedir(), '.config', 'vpsmonitor', 'web')
  const env = {
    ...loadEnv(mode, externalConfigDir, ''),
    ...loadEnv(mode, process.cwd(), ''),
    ...process.env,
  }
  const target = env.VPSMON_SSH_TARGET?.trim() ?? ''
  const autoTunnel =
    env.VPSMON_AUTO_SSH_TUNNEL === '1' &&
    env.VITE_USE_MOCK !== '1' &&
    process.env.VITEST !== 'true'

  return {
    plugins: [
      sshTunnelPlugin({
        enabled: autoTunnel && target.length > 0,
        target,
        localPort: readPort(env.VPSMON_SSH_LOCAL_PORT, 8787),
        remoteHost: env.VPSMON_SSH_REMOTE_HOST?.trim() || '127.0.0.1',
        remotePort: readPort(env.VPSMON_SSH_REMOTE_PORT, 18787),
        identityFile: env.VPSMON_SSH_IDENTITY_FILE?.trim() || undefined,
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: '127.0.0.1',
      port: 5273,
      strictPort: false,
    },
    preview: {
      host: '127.0.0.1',
      port: 5274,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          // 图表库体积最大且只在详情面板用到，单独切出去让首屏更快。
          manualChunks: {
            charts: ['recharts'],
            vendor: ['react', 'react-dom', '@tanstack/react-query'],
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      globals: false,
    },
  }
})
