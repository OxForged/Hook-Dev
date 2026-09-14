import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { applyTheme, readTheme } from './lib/theme.ts'
import './styles/tokens.css'
import './styles/admin.css'

applyTheme(readTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
