/* ============================================================================
   The tooltip card itself.

   Two decisions worth stating:

   - It renders through a PORTAL into <body> and is positioned `fixed`. Charts
     live inside cards that clip their overflow and inside ancestors that carry
     transforms (a transformed ancestor re-parents `position: fixed`), so a card
     positioned inside the plot is clipped at exactly the moment it matters —
     the outermost datum, at the narrowest viewport.

   - It carries `role="tooltip"` and an id, and the active datum points at it
     with `aria-describedby`. The previous card was `role="presentation"`, which
     tells a screen reader to ignore a box whose entire job is to state a number
     the reader cannot otherwise get. The datum's own `aria-label` still carries
     the value, so the tooltip is a second route to the number, never the only
     one.

   Position is written straight to the node in a layout effect rather than held
   in state: measuring the card and then re-rendering to move it is a render
   loop waiting to happen, and this way the card is never painted at the wrong
   place. `data-ready` gates the fade so the first frame is not a flash at 0,0.
   ============================================================================ */

import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { placeTip } from './tip'
import type { TipContent } from './tip'
import './chart-tip.css'

export function ChartTip({
  id,
  anchor,
  content,
}: {
  id: string
  anchor: Element | null
  content: TipContent | null
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor) return

    const place = () => {
      const a = anchor.getBoundingClientRect()
      const t = el.getBoundingClientRect()
      const p = placeTip(
        { left: a.left, top: a.top, width: a.width, height: a.height },
        { width: t.width, height: t.height },
        { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      )
      el.style.left = `${Math.round(p.left)}px`
      el.style.top = `${Math.round(p.top)}px`
      el.dataset['placement'] = p.placement
      el.dataset['ready'] = 'true'
    }

    place()
    // The anchor moves with the page; recompute rather than drift or vanish.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor, content])

  if (!anchor || !content) return null

  return createPortal(
    <div ref={ref} id={id} role="tooltip" className="chart-tip">
      <p className="chart-tip__title">{content.title}</p>
      {content.rows.map((r) => (
        <p className="chart-tip__row" key={`${r.label}-${r.value}`}>
          {r.color ? (
            <span className="chart-tip__key" style={{ background: r.color }} aria-hidden="true" />
          ) : null}
          <span className="chart-tip__val">{r.value}</span>
          <span className="chart-tip__label">{r.label}</span>
        </p>
      ))}
    </div>,
    document.body,
  )
}
