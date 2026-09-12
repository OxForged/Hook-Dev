// SPDX-License-Identifier: MIT
/* ============================================================================
   THE ONE FILE YOU EDIT.

   Everything needed to take this front end to market is below: the chain, the
   fee wallet, the branding and which features are on. There is no Solidity to
   fork, no address to hunt for in a component, and no second config.

   Your pools live in the Vault and pool managers Latch already has deployed and
   verified on the chain you pick. You are not deploying core. See README.md
   § "Shared core, not a full fork" for what that means and what it costs.

   After editing, check your work against the chain:

       npm run latch:verify

   It reads every configured address back, tells you which have code, what the
   pool manager's protocol fee controller currently is, and what a swap would
   actually cost a user. It sends no transaction.
   ============================================================================ */

import { defineLatchDex } from "./src/config/types";

export default defineLatchDex({
  /* --------------------------------------------------------------------------
     BRANDING
     -------------------------------------------------------------------------- */
  brand: {
    name: '__LATCH_APP_NAME__',

    /* Keep this true. It sits directly above numbers read from chain, and a
       tagline that claims something the app cannot show is the same class of
       error as an invented figure. */
    tagline: 'Swap and launch on Latch',

    /* Drop your own file in `public/` and point at it. Rendered 28px tall. */
    logoUrl: '/logo.svg',

    colors: {
      accent: '#2d5bff',
      onAccent: '#ffffff',
      background: '#0e1013',
      surface: '#16191e',
      surfaceAlt: '#1b1f25',
      text: '#f2f4f7',
      textMuted: '#98a2b3',
      border: '#262b33',
      positive: '#2f9e6b',
      negative: '#d94a4a',
    },

    fontFamily:
      "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    monoFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    radius: 12,

    /* Omit a link and it is not rendered. Nothing here invents a destination. */
    links: {
      // docs: 'https://docs.example.com',
      // x: 'https://x.com/example',
      // discord: 'https://discord.gg/example',
      // github: 'https://github.com/example/example',
      // terms: 'https://example.com/terms',
    },
  },

  /* --------------------------------------------------------------------------
     CHAIN
     -------------------------------------------------------------------------- */
  chain: {
    /* 4663 = Robinhood Chain (mainnet) · 11155111 = Ethereum Sepolia (testnet).
       Core addresses for both live in src/config/deployments.ts. */
    id: 4663 /* __LATCH_CHAIN_ID__ */,

    /* LatchRegistry — the shared marketplace of listed Latches (hook contracts).

       Deliberately NOT baked into deployments.ts. This contract is redeployable
       and has been redeployed once already, and a stale address does not fail
       loudly: it answers latchCount() with a number and renders as a healthy
       empty marketplace. Read it from a release note or from `latch:verify`,
       set it here, and leave it null until you have.  */
    registry: null,

    /* LaunchpadKit — the one-call launch factory (create pool, configure the
       launch-guard decay schedule, seed liquidity, list the hook).

       null disables every launch surface with an honest "not configured" state.
       There is no shared instance on any chain yet; see README.md
       § "The launchpad half is not live yet". */
    launchpadKit: null,

    /* Extra RPC URLs, tried before the SDK's probed public list. A keyed
       provider embeds its credential in the path, so read it from the
       environment and never commit the URL:

         rpcUrls: [import.meta.env.VITE_RPC_URL].filter(Boolean) as string[],  */
    rpcUrls: [],
  },

  /* --------------------------------------------------------------------------
     YOUR FEE — the reason this front end exists.

     Taken from the swap OUTPUT, inside the same transaction as the swap, by
     @latchprotocol/widgets. Nothing is escrowed, owed, or reconciled later:
     either the fee is paid atomically with the swap or the whole transaction
     reverts.

     It is capped at 100 bps (1%) by the widgets package.

     It is SEPARATE FROM, and stacks on top of, two other fees your users pay:
       · the pool's LP fee, set by whoever created the pool;
       · Latch's protocol fee, set by Latch governance on the shared pool
         manager and capped at 0.4% by core. You cannot change that one, and it
         is the price of not deploying nineteen contracts yourself.
     The Fees screen reads all three from chain and shows the composed total.
     -------------------------------------------------------------------------- */
  fee: {
    wallet: '0x0000000000000000000000000000000000000000' /* __LATCH_FEE_WALLET__ */,
    bps: 0 /* __LATCH_FEE_BPS__ */,
    mode: 'take-portion',
  },

  /* --------------------------------------------------------------------------
     FEATURES

     These gate navigation AND routing, so an off feature is unreachable rather
     than merely unlinked. No files were deleted; flip one back on any time.
     -------------------------------------------------------------------------- */
  features: {
    swap: true /* __LATCH_FEATURE_SWAP__ */,
    pools: true /* __LATCH_FEATURE_POOLS__ */,
    launchpad: true /* __LATCH_FEATURE_LAUNCHPAD__ */,
  },

  /* --------------------------------------------------------------------------
     TOKENS

     There is no on-chain token registry, so this list is yours. Symbols and
     decimals are read back from the contracts at runtime and a mismatch is
     shown rather than hidden — a token that lies about its symbol in a config
     file is how somebody swaps into the wrong asset.

     Start empty and add what you list. An empty list renders an honest empty
     picker; it does not invent a pair.
     -------------------------------------------------------------------------- */
  tokens: [],
});
