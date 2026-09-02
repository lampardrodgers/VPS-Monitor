import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

import { SSH_PROXY_PATH, sshOnDemandPlugin } from './dev/sshOnDemand'

function readPort(raw: string | undefined, fallback: number, allowZero = false): number {
  const value = Number(raw)
  if (allowZero && value === 0) return 0
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback
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
  const sshOnDemand =
    (env.VPSMON_SSH_ON_DEMAND === '1' || env.VPSMON_AUTO_SSH_TUNNEL === '1') &&
    env.VITE_USE_MOCK !== '1' &&
    process.env.VITEST !== 'true'

  return {
    define: sshOnDemand
      ? { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(SSH_PROXY_PATH) }
      : undefined,
    plugins: [
      sshOnDemandPlugin({
        enabled: sshOnDemand && target.length > 0,
        target,
        localPort: readPort(env.VPSMON_SSH_LOCAL_PORT, 0, true),
        remoteHost: env.VPSMON_SSH_REMOTE_HOST?.trim() || '127.0.0.1',
        remotePort: readPort(env.VPSMON_SSH_REMOTE_PORT, 18787),
        identityFile: env.VPSMON_SSH_IDENTITY_FILE?.trim() || undefined,
        idleMs: readPort(env.VPSMON_SSH_IDLE_MS, 500),
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
