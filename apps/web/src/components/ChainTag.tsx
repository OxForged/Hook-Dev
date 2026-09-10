/* ============================================================================
   The chain a record lives on, as a label.

   One component rather than a `CHAIN_ROWS.find(...)` repeated at every call
   site, because the interesting case is the one a find-inline gets wrong: a
   chain id the app does not know. That happens for real — a wallet on an
   unlisted network, a record read from a chain later removed from the list —
   and the honest answer is "chain 8453", not a blank space and not a guess.

   Everything here takes a chain ID rather than a brand, because that is what
   the records now carry (see `chainId` on RegisteredLatch, PoolRecord and the
   rest). Resolving id -> brand is exactly the lookup that should live in one
   place.
   ============================================================================ */

import { CHAIN_ROWS } from '../data/chains.ts'
import type { ChainRow } from '../data/chains.ts'
import { ChainMark } from './ChainMark.tsx'

export function chainRowFor(chainId: number): ChainRow | undefined {
  return CHAIN_ROWS.find((r) => r.chainId === chainId)
}

/** The chain's own name, or a legible fallback for one we do not carry. */
export function chainNameFor(chainId: number): string {
  return chainRowFor(chainId)?.name ?? `Chain ${chainId}`
}

interface ChainTagProps {
  readonly chainId: number
  /** Mark size in px. Defaults to 14, which suits inline use in a table row. */
  readonly size?: number
  /**
   * Show the chain's name beside the mark. Defaults to true.
   *
   * Set false where the surrounding text already names the chain and the mark is
   * only reinforcing it — a duplicated name reads as a stutter, and the
   * accessible name below keeps it available to a screen reader either way.
   */
  readonly showName?: boolean
  readonly className?: string
}

/**
 * A chain mark plus its name.
 *
 * The mark alone is never the whole label: an icon-only chain indicator asks the
 * reader to recognise a logo, which is fine for Ethereum and hopeless for the
 * long tail. When `showName` is false the name still ships as visually-hidden
 * text, so the row is unambiguous to a screen reader even when it is compact on
 * screen.
 */
export function ChainTag({ chainId, size = 14, showName = true, className }: ChainTagProps) {
  const row = chainRowFor(chainId)
  const name = row?.name ?? `Chain ${chainId}`

  return (
    <span className={className ? `chain-tag ${className}` : 'chain-tag'}>
      {row ? (
        <ChainMark brand={row.brand} size={size} className="chain-tag__mark" />
      ) : (
        // An unknown chain gets a neutral dot, not a borrowed logo. Rendering
        // some other network's mark here would be worse than rendering nothing.
        <span className="chain-tag__unknown" aria-hidden="true" />
      )}
      {showName ? (
        <span className="chain-tag__name">{name}</span>
      ) : (
        <span className="dapp-sr">{name}</span>
      )}
    </span>
  )
}
