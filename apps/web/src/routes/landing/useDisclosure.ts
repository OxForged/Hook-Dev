/**
 * Behaviour for the header's mobile disclosure menu.
 *
 * Deliberately a local copy of the two hooks the dapp shell uses for its
 * drawer (`src/routes/dapp/lib/dom.ts`) rather than an import: the marketing
 * chrome and the dapp shell are separate surfaces with separate owners, and a
 * landing-page header that breaks when someone tunes the dapp drawer is a
 * coupling nobody asked for. The semantics are identical on purpose — Escape
 * closes, Tab cycles inside the panel, focus returns where it came from — so a
 * visitor moving between the two surfaces meets the same keyboard contract.
 */

import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    mql.addEventListener('change', onChange)
    setMatches(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Traps Tab inside `container` while `active`, calls `onClose` on Escape and
 * restores focus to whatever was focused before the trap engaged — the menu
 * button, in practice, so a keyboard user is never dumped at the top of the
 * document after closing the menu.
 */
export function useFocusTrap(
  container: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!active) return
    const node = container.current
    if (!node) return

    const previous = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))

    focusables()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const head = items[0]
      const tail = items[items.length - 1]
      if (!head || !tail) return
      const current = document.activeElement
      if (event.shiftKey && (current === head || !node.contains(current))) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && current === tail) {
        event.preventDefault()
        head.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus?.()
    }
  }, [active, container, onClose])
}
