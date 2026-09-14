export type ThemeChoice = 'system' | 'light' | 'dark'
const KEY = 'latch-theme'

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Same mechanism as apps/web lib/theme.ts: data-theme for an explicit choice, absent for system. */
export function applyTheme(t: ThemeChoice): void {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
  try {
    if (t === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, t)
  } catch {
    /* per-viewer convenience only */
  }
}
