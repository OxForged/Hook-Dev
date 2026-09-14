/* ============================================================================
   Small DOM hooks: viewport query + a real focus trap for the mobile drawer.
   ============================================================================ */

import { useEffect, useRef, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
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
 * Traps Tab inside `container` while `active`, calls `onClose` on Escape, and
 * restores focus to whatever was focused before the trap engaged.
 */
export function useFocusTrap(
  container: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
): void {
  /* `onClose` is read through a ref, NOT listed as an effect dependency. The
     shell passes a closure and re-renders on every block tick; with the
     callback in the dependency list the effect tore down and re-ran on each of
     those renders — restoring focus to the burger and then yanking it back to
     the first nav row, several times a minute, while the drawer was open. */
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!active) return
    const node = container.current
    if (!node) return

    const previous = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))

    const first = focusables()[0]
    first?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
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
  }, [active, container])
}

/**
 * Locks page scroll while `active` — the open nav drawer. Without it a phone
 * scrolls the page BEHIND the scrim when the drawer's own list reaches its end.
 * The previous inline values are restored rather than blanked, so a lock
 * never clobbers somebody else's.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    const body = document.body
    const prevRoot = root.style.overflow
    const prevBody = body.style.overflow
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      root.style.overflow = prevRoot
      body.style.overflow = prevBody
    }
  }, [active])
}

/**
 * Gives every body cell of every `.dapp-table` under `container` a
 * `data-label` copied from its column header, unless the cell already has one.
 *
 * WHY THIS EXISTS. Under 720px dapp.css stacks a table into label/value cards,
 * and the label is `attr(data-label)`. Portfolio and Governance wrote that
 * attribute by hand; Claim, Revenue share and Epochs never did, so their phone
 * cards showed bare values with nothing saying which column each one was. The
 * header row already holds the words, so they are copied from it — one
 * mechanism for every table, present and future, and no second copy of the
 * column names to drift from the first.
 *
 * Presentational only: it reads `<th scope="col">` text and writes an
 * attribute React does not manage, so a re-render never removes it. A cell
 * spanning several columns has no single header and is left unlabelled.
 */
export function useTableLabels(container: React.RefObject<HTMLElement | null>, key: string): void {
  useEffect(() => {
    const root = container.current
    if (!root || typeof MutationObserver === 'undefined') return

    const label = () => {
      for (const table of root.querySelectorAll<HTMLTableElement>('table.dapp-table')) {
        const headRow = table.tHead?.rows[0]
        if (!headRow) continue
        const names: string[] = []
        for (const th of Array.from(headRow.cells)) {
          const text = (th.textContent ?? '').replace(/\s+/g, ' ').trim()
          for (let i = 0; i < th.colSpan; i++) names.push(text)
        }
        for (const body of Array.from(table.tBodies)) {
          for (const row of Array.from(body.rows)) {
            let col = 0
            for (const cell of Array.from(row.cells)) {
              if (cell.colSpan === 1 && !cell.hasAttribute('data-label')) {
                const name = names[col]
                if (name) cell.setAttribute('data-label', name)
              }
              col += cell.colSpan
            }
          }
        }
      }
    }

    label()
    const observer = new MutationObserver(label)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [container, key])
}
