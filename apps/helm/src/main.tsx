import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@helm/ui/styles/fonts.css'
import '@helm/ui/styles/global.css'
import { App } from './App'
import { HelmProvider } from './state/store'
import { HelmWidgetHost } from './state/widgetHost'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmProvider>
      <HelmWidgetHost>
        <App />
      </HelmWidgetHost>
    </HelmProvider>
  </StrictMode>,
)
