/* ============================================================================
   Settings data — SCREENS.md § C7.
   MOCK SEAM: `loadSettings()`. Preferences live in component state only; the
   API key is a placeholder string and ROTATE calls nothing.
   ============================================================================ */

import type { ChainKey, ChainRow } from '../../../data/chains.ts'
import { CHAIN_ROWS, MAINNET_CHAINS, TESTNET_CHAINS } from '../../../data/chains.ts'
import type { Flags } from './types.ts'

export interface TogglePref {
  key: keyof Flags
  name: string
  hint: string
}

export interface SettingsData {
  toggles: TogglePref[]
  /** Every target chain, derived from the SDK — see src/data/chains.ts. */
  networks: readonly ChainRow[]
  mainnets: readonly ChainRow[]
  testnets: readonly ChainRow[]
  /** README § State management: `net` default. */
  defaultNetwork: ChainKey
  /** README § State management: `flags` defaults. */
  defaultFlags: Flags
  apiKey: string
  apiNote: string
}

export function loadSettings(): SettingsData {
  return {
    toggles: [
      {
        key: 'sim',
        name: 'Simulate before every registration',
        hint: 'Replays 1,000 recent swaps against your latch',
      },
      {
        key: 'alerts',
        name: 'Revert alerts',
        hint: 'Notify when a latch reverts more than 0.1% of calls',
      },
      {
        key: 'testnet',
        name: 'Show testnet deployments',
        hint: 'Include Ethereum Sepolia, Monad, Stable and Arc testnets in lists',
      },
      {
        key: 'autoGas',
        name: 'Auto gas sponsorship',
        hint: 'Draw from credits when a caller cannot pay',
      },
    ],
    networks: CHAIN_ROWS,
    mainnets: MAINNET_CHAINS,
    testnets: TESTNET_CHAINS,
    /* Sepolia, because it is the only chain Latch is actually deployed on.
       Defaulting to a mainnet would put the app on a chain with no contracts. */
    defaultNetwork: 'sepolia',
    /* The README's default has `testnet` off. It is on here for the same reason:
       with Sepolia the only deployment, hiding testnets hides everything real. */
    defaultFlags: { sim: true, alerts: true, testnet: true, autoGas: true },
    apiKey: 'latch_sk_••••••••••••7f21',
    apiNote: 'Rotating the key invalidates existing simulation sessions within 60 seconds.',
  }
}
