/* ============================================================================
   One tooltip per chart, driven by whichever datum the reader is pointing at,
   focused, or has tapped.

   Input model, deliberately covering all three:

     pointer   pointerenter shows, pointerleave hides
     keyboard  focus shows, blur hides, Escape dismisses
     touch     a tap PINS the card (a hover-only tooltip is invisible on a
               phone). Tapping the same datum again, tapping outside, or
               pressing Escape puts it away.

   `open` is deliberately allowed to move a pinned card to another datum: if
   the reader points somewhere else, that is what they want to read.
   ============================================================================ */

import { useCallback, useEffect, useId, useState } from 'react'
import type { FocusEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import { ChartTip } from './ChartTip'
import type { TipContent } from './tip'

interface TipState {
  readonly id: string
  readonly el: Element
  readonly content: TipContent
  readonly pinned: boolean
}

/** Props to spread onto a focusable datum (a `<button>`, an SVG arc, a row). */
export interface DatumTipProps {
  onPointerEnter: (e: PointerEvent<Element>) => void
  onPointerLeave: () => void
  onFocus: (e: FocusEvent<Element>) => void
  onBlur: () => void
  onClick: (e: MouseEvent<Element>) => void
  'aria-describedby': string | undefined
}

export interface ChartTipApi {
  /** Id of the datum the card is currently describing, or null. */
  activeId: string | null
  /** Everything needed to make one datum speak. */
  datumProps: (id: string, content: TipContent) => DatumTipProps
  /** The card. Render it once, anywhere inside the chart's tree. */
  element: ReactNode
}

export function useChartTip(): ChartTipApi {
  const tipId = useId()
  const [tip, setTip] = useState<TipState | null>(null)

  const open = useCallback((id: string, el: Element, content: TipContent) => {
    setTip((prev) => ({ id, el, content, pinned: prev?.id === id ? prev.pinned : false }))
  }, [])

  const close = useCallback((id: string) => {
    setTip((prev) => (prev === null || prev.id !== id || prev.pinned ? prev : null))
  }, [])

  const toggle = useCallback((id: string, el: Element, content: TipContent) => {
    setTip((prev) =>
      prev?.id === id && prev.pinned ? null : { id, el, content, pinned: true },
    )
  }, [])

  const pinned = tip?.pinned ?? false

  useEffect(() => {
    if (!pinned) return
    const onPointerDown = (e: Event) => {
      const target = e.target
      setTip((prev) => {
        if (prev === null) return prev
        if (target instanceof Node && prev.el.contains(target)) return prev
        return null
      })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pinned])

  const datumProps = useCallback(
    (id: string, content: TipContent): DatumTipProps => ({
      onPointerEnter: (e) => open(id, e.currentTarget, content),
      onPointerLeave: () => close(id),
      onFocus: (e) => open(id, e.currentTarget, content),
      onBlur: () => close(id),
      onClick: (e) => toggle(id, e.currentTarget, content),
      'aria-describedby': tip?.id === id ? tipId : undefined,
    }),
    [open, close, toggle, tip?.id, tipId],
  )

  return {
    activeId: tip?.id ?? null,
    datumProps,
    element: <ChartTip id={tipId} anchor={tip?.el ?? null} content={tip?.content ?? null} />,
  }
}
