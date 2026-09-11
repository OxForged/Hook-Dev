/**
 * Theme mechanism — the non-React core of the light/dark/system switcher.
 *
 * Three states, not two: `light`, `dark`, `system` (follow the OS). `system`
 * is the default for a first-time visitor and for anyone whose stored value
 * is missing or unparseable.
 *
 * The resolved theme is published as `data-theme="light"` / `data-theme="dark"`
 * on `<html>`. In `system` mode NO `data-theme` attribute is set at all — the
 * CSS (owned by styles/tokens.css) falls through to a `prefers-color-scheme`
 * media query. `system` is never resolved to a literal in the DOM: doing that
 * would freeze the page at whatever the OS said at load time, and it would
 * stop following the OS if the visitor changes it mid-session.
 *
 * The preference persists in `localStorage` under `latch-theme`. Every read
 * and write is wrapped in try/catch: storage access throws outright in some
 * contexts (private windows, blocked site data), and a thrown theme read
 * must never take the page down.
 *
 * See apps/web/index.html for the inline anti-flash script, which duplicates
 * only the "light or dark -> set the attribute before first paint" half of
 * this logic (it must not import anything, so it cannot call these functions
 * directly — keep the two in sync if this file's storage contract changes).
 */

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'latch-theme'

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** Absent or unparseable stored value resolves to `system`, never throws. */
export function readStoredChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeChoice(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

function writeStoredChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // Storage may be unavailable (private windows, blocked site data). The
    // choice still governs this page life; it just will not persist.
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** What `choice` currently means for `light`/`dark` consumers (e.g. an icon). */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return choice
}

/**
 * Writes `choice` to the DOM: `data-theme` for `light`/`dark`, no attribute
 * at all for `system`. Returns the resolved theme for callers that also need
 * a concrete `light`/`dark` value (e.g. to pick an icon).
 */
function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const root = document.documentElement
  if (choice === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', choice)
  }
  return resolveTheme(choice)
}

/**
 * Subscribes to OS scheme changes. Only matters while the active choice is
 * `system`, but is safe to hold at all times. Falls back to the legacy
 * `addListener`/`removeListener` pair for older engines; never throws.
 */
function subscribeSystemTheme(onChange: () => void): () => void {
  try {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    type LegacyMql = {
      addListener: (cb: () => void) => void
      removeListener: (cb: () => void) => void
    }
    const legacy = mql as unknown as LegacyMql
    legacy.addListener(onChange)
    return () => legacy.removeListener(onChange)
  } catch {
    return () => {}
  }
}

type Listener = () => void

/**
 * Module-level store so every consumer (the hook, multiple `ThemeToggle`
 * instances, the eventual dapp top bar) shares one source of truth and one
 * OS subscription rather than each re-deriving and re-applying the theme.
 */
let currentChoice: ThemeChoice = readStoredChoice()
let currentResolved: ResolvedTheme = applyTheme(currentChoice)
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) listener()
}

subscribeSystemTheme(() => {
  if (currentChoice !== 'system') return
  currentResolved = applyTheme(currentChoice)
  notify()
})

export function getThemeChoice(): ThemeChoice {
  return currentChoice
}

export function getResolvedTheme(): ResolvedTheme {
  return currentResolved
}

export function setThemeChoice(choice: ThemeChoice): void {
  if (choice === currentChoice) return
  currentChoice = choice
  writeStoredChoice(choice)
  currentResolved = applyTheme(choice)
  notify()
}

/** For `useSyncExternalStore`. Returns an unsubscribe function. */
export function subscribeThemeChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
