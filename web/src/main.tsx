import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import { QueryProvider } from '@/api/QueryProvider'
import { PreferencesProvider } from '@/hooks/preferences'
import { installMockApi } from '@/mock/installMockApi'
import '@/index.css'

installMockApi()

const container = document.getElementById('root')
if (!container) {
  throw new Error('缺少 #root 挂载点')
}

createRoot(container).render(
  <StrictMode>
    <PreferencesProvider>
      <QueryProvider>
        <App />
      </QueryProvider>
    </PreferencesProvider>
  </StrictMode>,
)
