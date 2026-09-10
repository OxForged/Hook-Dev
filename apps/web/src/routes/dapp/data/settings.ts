/* ============================================================================
   Settings data — SCREENS.md § C7.
   MOCK SEAM: `loadSettings()`. Preferences live in component state only; the
   API key is a placeholder string and ROTATE calls nothing.
   ============================================================================ */

import type { Flags } from './types.ts'

export interface TogglePref {
  key: keyof Flags
  name: string
  hint: string
}

export interface SettingsData {
  toggles: TogglePref[]
  networks: string[]
  /** README § State management: `net` default. */
  defaultNetwork: string
  /** README § State management: `flags` defaults — all on except testnet. */
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
        hint: 'Include Sepolia and Base Sepolia in lists',
      },
      {
        key: 'autoGas',
        name: 'Auto gas sponsorship',
        hint: 'Draw from credits when a caller cannot pay',
      },
    ],
    networks: ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon'],
    defaultNetwork: 'Base',
    defaultFlags: { sim: true, alerts: true, testnet: false, autoGas: true },
    apiKey: 'latch_sk_••••••••••••7f21',
    apiNote: 'Rotating the key invalidates existing simulation sessions within 60 seconds.',
  }
}
