/* ============================================================================
   The mark for one chain, shared by the landing page and the dapp.

   Two states, and only two:

     · An OFFICIAL brand asset, fetched from the chain's own brand page or
       GitHub org and stored under public/chains/ (provenance in
       public/chains/SOURCES.md). Rendered at its natural aspect ratio inside a
       square box — never stretched, never recoloured.

     · A typographic MONOGRAM in the design system's own type and tokens, used
       where no official mark could be sourced. It reads as a placeholder on
       purpose. Drawing an approximation of somebody else's logo would
       misrepresent them, so it is not an option here.
   ============================================================================ */

import type { ChainBrand } from '../data/chains.ts'

interface ChainMarkProps {
  readonly brand: ChainBrand
  /**
   * Intrinsic size hint in px, so the box is reserved before the asset loads and
   * the grid never reflows. The surface's own CSS class is what finally sizes it.
   */
  readonly size: number
  /** Class for the box, whichever state renders. */
  readonly className?: string | undefined
}

export function ChainMark({ brand, size, className }: ChainMarkProps) {
  if (brand.logo !== null) {
    return (
      <img
        className={className}
        src={brand.logo}
        alt={`${brand.name} logo`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
      />
    )
  }

  return (
    <span
      className={className}
      role="img"
      aria-label={`${brand.name} — no official logo available, shown as a monogram`}
      data-size={size}
    >
      <span aria-hidden="true">{brand.monogram}</span>
    </span>
  )
}
