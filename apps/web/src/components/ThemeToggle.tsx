import { useTheme } from '../lib/useTheme'
import type { ThemeChoice } from '../lib/theme'
import './ThemeToggle.css'

/** Join truthy class names. Colocated rather than imported from the landing
 *  route's `cx` — this component is shared by landing, docs and the dapp, and
 *  must not pull in a route-scoped module. */
function cx(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4.5" width="18" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 20.5h7M12 16.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const OPTIONS: readonly { choice: ThemeChoice; label: string; icon: () => React.JSX.Element }[] = [
  { choice: 'light', label: 'Light', icon: SunIcon },
  { choice: 'system', label: 'System', icon: MonitorIcon },
  { choice: 'dark', label: 'Dark', icon: MoonIcon },
]

/**
 * Three-way Light / System / Dark control.
 *
 * `role="group"` + `aria-pressed` per button (not a native `<select>` or a
 * two-state switch): three mutually-exclusive, always-visible options, each
 * independently announced as pressed/not-pressed, which is exactly what
 * `aria-pressed` toggle buttons communicate. Native `<button>` elements are
 * keyboard-reachable and activate on Enter/Space with no extra wiring.
 *
 * `showLabels` prints the option name next to its icon (used on the Settings
 * "Appearance" row, where the control stands alone and space is not tight).
 * The icon-only default (headers) still exposes the same name to assistive
 * tech via visually-hidden text, matching the header socials' convention of
 * a real text node over `aria-label` (see SocialIcons.tsx).
 */
export function ThemeToggle({
  className,
  showLabels = false,
}: {
  className?: string
  showLabels?: boolean
}) {
  const { choice, setChoice } = useTheme()

  return (
    <div className={cx('theme-toggle', className)} role="group" aria-label="Theme">
      {OPTIONS.map((opt) => {
        const active = choice === opt.choice
        const Icon = opt.icon
        return (
          <button
            key={opt.choice}
            type="button"
            className={cx('theme-toggle__btn', active && 'is-active')}
            aria-pressed={active}
            onClick={() => setChoice(opt.choice)}
          >
            <Icon />
            {showLabels ? (
              <span className="theme-toggle__label">{opt.label}</span>
            ) : (
              <span className="theme-toggle__sr-only">{opt.label}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
