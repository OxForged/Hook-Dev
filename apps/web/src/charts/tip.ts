/* ============================================================================
   Chart tooltip — shapes and placement geometry.

   Kept free of React and of the DOM so the collision rules are a pure function
   of four rectangles and can be reasoned about (and tested) on their own.

   Placement rule, in order:
     1. Centre the card on the anchor and clamp it inside the viewport
        horizontally. Clamping, not clipping: a card at the right-hand edge
        slides left rather than losing its digits.
     2. Prefer sitting ABOVE the anchor. If there is not room above, flip
        BELOW. If there is room in neither direction, clamp vertically and
        accept the overlap — a legible card that covers part of a bar beats an
        unreadable one that respects it.
   ============================================================================ */

/** One line of a tooltip: the exact number first, what it measures second. */
export interface TipRow {
  /** What the number measures — "Protocol", "Events", "Share". */
  readonly label: string
  /** The exact underlying value, already formatted, with its unit. */
  readonly value: string
  /** Optional series colour. Always a `var(--token)`, never a literal. */
  readonly color?: string
}

export interface TipContent {
  readonly title: string
  readonly rows: readonly TipRow[]
}

export type TipPlacement = 'above' | 'below'

export interface Box {
  readonly width: number
  readonly height: number
}

export interface AnchorBox extends Box {
  readonly left: number
  readonly top: number
}

export interface PlacedTip {
  readonly left: number
  readonly top: number
  readonly placement: TipPlacement
}

/** Distance kept from the viewport edge. */
const MARGIN = 8
/** Distance kept between the anchor and the card. */
const GAP = 10

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

export function placeTip(anchor: AnchorBox, tip: Box, view: Box): PlacedTip {
  const left = clamp(
    anchor.left + anchor.width / 2 - tip.width / 2,
    MARGIN,
    view.width - tip.width - MARGIN,
  )

  const above = anchor.top - GAP - tip.height
  const below = anchor.top + anchor.height + GAP
  const fitsAbove = above >= MARGIN
  const fitsBelow = below + tip.height <= view.height - MARGIN

  if (fitsAbove) return { left, top: above, placement: 'above' }
  if (fitsBelow) return { left, top: below, placement: 'below' }

  // Neither side fits: keep the card on screen and let it overlap.
  return {
    left,
    top: clamp(below, MARGIN, view.height - tip.height - MARGIN),
    placement: 'below',
  }
}
