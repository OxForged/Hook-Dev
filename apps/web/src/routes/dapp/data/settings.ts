/* ============================================================================
   Settings data — SCREENS.md § C7.

   The API key is GONE. It was `latch_sk_••••••••••••7f21` beside a ROTATE button
   that called nothing: there is no Latch API and no account system, so both the
   credential and the action were fiction dressed as a feature. The screen now
   shows the configuration that genuinely exists — the RPC endpoints in use and
   the two build-time variables that switch real features on.

   THE FOUR PREFERENCE SWITCHES ARE GONE FOR THE SAME REASON, and they were the
   larger lie of the two. Nothing outside this screen ever read `flags`: the
   switches moved a knob and changed nothing. What made them worse than dead
   code is what they claimed while doing it —

     sim      "Replays 1,000 recent swaps against your latch"
     alerts   "Notify when a latch reverts more than 0.1% of calls"
     autoGas  "Draw from credits when a caller cannot pay"
     testnet  "Show testnet deployments" — no list was ever filtered by it

   — three simulation, monitoring and gas-sponsorship products that do not
   exist, and one filter that did nothing, presented as settings a user had
   already switched on. A reader deciding whether to trust a contract in their
   swap path was being told this app replays swaps against it. It does not.

   `defaultFlags` and the `Flags` type STAY, because `routes/dapp/state.tsx`
   seeds its store from them and that store is shared. They are inert defaults
   for a field nothing reads — not a seam to hang new switches on. A preference
   belongs here once something honours it, and not before.
   ============================================================================ */

import { IS_TESTNET_BUILD } from '../../../lib/chain'
import type { ChainKey, ChainRow } from '../../../data/chains.ts'
import { CHAIN_ROWS, MAINNET_CHAINS, TESTNET_CHAINS } from '../../../data/chains.ts'
import type { Flags } from './types.ts'

export interface SettingsData {
  /** Every target chain, derived from the SDK — see src/data/chains.ts. */
  networks: readonly ChainRow[]
  mainnets: readonly ChainRow[]
  testnets: readonly ChainRow[]
  /** Chains with contracts. Derived, so copy cannot claim a stale exclusivity. */
  deployed: readonly ChainRow[]
  /** README § State management: `net` default. */
  defaultNetwork: ChainKey
  /** README § State management: `flags` defaults. Inert — see the header. */
  defaultFlags: Flags
}

export function loadSettings(): SettingsData {
  return {
    networks: CHAIN_ROWS,
    mainnets: MAINNET_CHAINS,
    testnets: TESTNET_CHAINS,
    deployed: CHAIN_ROWS.filter((c) => c.deployed),
    /* Follows the build, not a literal. A mainnet build defaulting to a
       testnet chain is how the header ends up saying Sepolia over mainnet
       data. See ACTIVE_CHAIN_ID in lib/chain.ts. */
    defaultNetwork: IS_TESTNET_BUILD ? 'sepolia' : 'robinhood',
    defaultFlags: { sim: true, alerts: true, testnet: true, autoGas: true },
  }
}
