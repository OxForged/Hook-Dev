import { useCallback, useSyncExternalStore } from 'react'
import {
  getResolvedTheme,
  getThemeChoice,
  setThemeChoice,
  subscribeThemeChange,
  type ResolvedTheme,
  type ThemeChoice,
} from './theme'

export type UseThemeResult = {
  /** What the visitor picked: `light` | `dark` | `system`. */
  choice: ThemeChoice
  /** What `choice` currently renders as. Always `light` or `dark`, never `system`. */
  resolved: ResolvedTheme
  setChoice: (choice: ThemeChoice) => void
}

/**
 * React binding over `lib/theme.ts`'s module-level store.
 *
 * Uses `useSyncExternalStore` rather than a `useState` + `useEffect`
 * subscription: the theme can change from outside this component's own
 * effects (another `ThemeToggle` instance, or the OS itself while `choice`
 * is `system`), which is exactly the tearing hazard the hook exists to
 * prevent, and it sidesteps the set-state-in-effect pattern oxlint already
 * flags elsewhere in this codebase.
 */
export function useTheme(): UseThemeResult {
  const choice = useSyncExternalStore(subscribeThemeChange, getThemeChoice)
  const resolved = useSyncExternalStore(subscribeThemeChange, getResolvedTheme)
  const setChoice = useCallback((next: ThemeChoice) => setThemeChoice(next), [])
  return { choice, resolved, setChoice }
}
