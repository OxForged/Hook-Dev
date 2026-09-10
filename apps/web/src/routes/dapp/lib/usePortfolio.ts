import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'

import type { DeployedChainId } from '../../../lib/chain'
import { readPortfolio, type Portfolio } from '../data/portfolio'

export type PortfolioState =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; p: Portfolio }

type Settled = Exclude<PortfolioState, { k: 'loading' }>

/**
 * One address's live portfolio, in the same three-state shape as
 * lib/useMetrics.ts — and with the same rule: no mock fallback. An unreachable
 * chain is an error the screen shows, never a quietly substituted figure.
 *
 * Re-reads whenever the address or chain changes, and on `reload()`. A settled
 * result is tagged with the request it answered; a result for a previous
 * address is never shown against the current one, and "loading" is derived
 * during render rather than set from inside the effect.
 */
export function usePortfolio(
  address: Address | undefined,
  chainId: DeployedChainId | undefined,
): { state: PortfolioState; reload: () => void } {
  const [nonce, setNonce] = useState(0)
  const [settled, setSettled] = useState<{ key: string; s: Settled } | null>(null)

  const key = address && chainId !== undefined ? `${chainId}:${address.toLowerCase()}:${nonce}` : ''

  useEffect(() => {
    if (!address || chainId === undefined) return
    let off = false
    readPortfolio(address, chainId)
      .then((p) => !off && setSettled({ key, s: { k: 'ready', p } }))
      .catch(
        (e) =>
          !off &&
          setSettled({
            key,
            s: { k: 'error', message: e instanceof Error ? e.message : 'unreachable' },
          }),
      )
    return () => {
      off = true
    }
  }, [address, chainId, key])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const state: PortfolioState = settled && settled.key === key ? settled.s : { k: 'loading' }
  return { state, reload }
}
