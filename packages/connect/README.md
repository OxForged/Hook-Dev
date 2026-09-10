# @latchprotocol/connect

The wallet layer for Latch Protocol: a thin, Latch-themed wrapper over
[RainbowKit](https://rainbowkit.com) and [wagmi](https://wagmi.sh), plus the
Latch chain list — wagmi's curated chain identities carrying probed,
redundant public RPC endpoints instead of wagmi's one-to-three defaults.

It **wraps** RainbowKit. It does not fork it. See
[Why a wrapper and not a fork](#why-a-wrapper-and-not-a-fork).

Licensed **MIT** (see `LICENSE`). This package is deliberately independent of
the GPL-2.0 Latch core so that applications and hook developers can build
against it without importing GPL code.

## Install

```sh
npm install @latchprotocol/connect @rainbow-me/rainbowkit wagmi viem @tanstack/react-query
```

Peer dependencies (you install them; this package does not bundle them):

| Package                   | Range                  |
| ------------------------- | ---------------------- |
| `@rainbow-me/rainbowkit`  | `^2.2.0`               |
| `wagmi`                   | `^2.9.0`               |
| `viem`                    | `2.x`                  |
| `@tanstack/react-query`   | `^5.0.0`               |
| `react`, `react-dom`      | `^18.0.0 \|\| ^19.0.0` |

Node `>=20`. ESM only.

## Usage

Two stylesheets, RainbowKit's first, then ours:

```ts
import '@rainbow-me/rainbowkit/styles.css'
import '@latchprotocol/connect/styles.css'
```

Create the wagmi config **once**, at module scope, and pass it to the provider.
A config rebuilt on render tears down every connector and drops the live
session.

```tsx
// wallet.ts
import { createLatchConfig } from '@latchprotocol/connect'

export const wagmiConfig = createLatchConfig({
  appName: 'My Latch App',
  // projectId: '...',   // WalletConnect; defaults to VITE_WALLETCONNECT_PROJECT_ID
  // chains: [sepolia],  // narrow to the chains your app actually writes to
})
```

```tsx
// App.tsx
import {
  LatchWalletProvider,
  LatchConnectButton,
  LatchChainSwitcher,
} from '@latchprotocol/connect'

import { wagmiConfig } from './wallet'

export function App() {
  return (
    <LatchWalletProvider config={wagmiConfig}>
      <header>
        <LatchChainSwitcher />
        <LatchConnectButton variant="inline" />
      </header>
      {/* your routes; any wagmi hook works below this point */}
    </LatchWalletProvider>
  )
}
```

`LatchWalletProvider` mounts `WagmiProvider -> QueryClientProvider ->
RainbowKitProvider` in that order, applies the Latch theme, and targets
Ethereum Sepolia for a fresh connection. Pass `queryClient` to share an
existing TanStack client, and `theme` to override or disable the Latch theme.

### `<LatchConnectButton />`

RainbowKit's `ConnectButton.Custom` with Latch markup. Handles every
connection state explicitly, including "wrong network", which opens the chain
modal rather than falling through to a connected pill.

| Prop          | Default             | Notes                                  |
| ------------- | ------------------- | -------------------------------------- |
| `variant`     | `'sidebar'`         | `'sidebar'` fills width; `'inline'` is a compact pill |
| `showChain`   | `false`             | chain chip beside the account          |
| `showBalance` | `false`             | native balance in the account pill     |
| `label`       | `'Connect wallet'`  | disconnected-state label               |
| `className`   |                     | extra class on the outer element       |

### `<LatchChainSwitcher />`

A menu over wagmi's `useSwitchChain`, grouped by the only question a user is
actually asking — *can I use this right now*:

```
AVAILABLE
  ● Sepolia                    TEST  ✓
COMING SOON
  ● Ethereum
  ● Base
  ● BNB Smart Chain
  …
```

**Available** is `LATCH_DEPLOYED_CHAIN_IDS`. **Coming soon** is everything else
in the config: endpoint-verified deploy targets with no contracts yet. Testnet
is a per-row `TEST` tag, not a group — it qualifies a chain, it does not decide
whether the app works.

Coming-soon rows are **inert and say so**. They carry `aria-disabled="true"`
and the reason in their accessible name, and they stay in the tab order so a
keyboard or screen-reader user can reach that reason. They are not silently
no-op. Letting the switch through instead was rejected: `switchChain` to a
chain the wallet does not know triggers `wallet_addEthereumChain`, which is a
permanent change to the user's wallet, requested so they can look at an app
with no contracts on it.

| Prop           | Default | Notes                                       |
| -------------- | ------- | ------------------------------------------- |
| `renderIcon`   |         | `(chain: Chain) => ReactNode` — see below   |
| `onlyDeployed` | `false` | `true` drops the "Coming soon" section; falls back to the full list if that would be empty |
| `grouped`      | `true`  | Available / Coming soon sections; ungrouped, inert rows grow a visible `SOON` tag |
| `onSwitch`     |         | `(chainId: number) => void` after a successful switch |
| `className`    |         |                                             |

Keyboard: `↑`/`↓` wrap through every row, `Home`/`End` jump to the ends,
`Enter`/`Space` select, `Escape` closes and returns focus to the trigger, `Tab`
closes and moves on. Opening the menu focuses the row for the chain you are
already on.

#### Chain icons: `renderIcon`

**This package ships no chain logos** and never reads from a host
application's `public/` directory. Supply them with a render prop:

```tsx
<LatchChainSwitcher renderIcon={(chain) => <MyChainLogo chainId={chain.id} />} />
```

It is called once per row and once for the trigger. Return an `<img>`, an
inline `<svg>`, anything — the switcher wraps it in `.latch-chain__icon` and
sizes that box, so a square 16–18px asset is the natural thing to hand back.
Return `null` for a chain you have no asset for and that one row falls back.

**Omit the prop entirely and the switcher still works.** Every row renders a
typographic monogram — the chain's first letter in the host's own type and
tokens. That is a deliberate placeholder, not a degraded state: an approximated
logo would misrepresent somebody else's brand, and a guessed asset path would
be a broken image.

### WalletConnect

`createLatchConfig` reads `VITE_WALLETCONNECT_PROJECT_ID` from the build
environment (or takes `projectId` directly). When no id is present,
WalletConnect-backed wallets are **omitted from the modal** instead of failing
at connect time; only injected, Coinbase and Safe connectors are offered.
`hasWalletConnect()` reports which mode you are in.

The id is a public identifier, not a secret, but it is still read from the
environment so a fork does not silently bill its traffic to Latch's quota.

## Chains

```ts
import { LATCH_CHAINS, LATCH_DEPLOYED_CHAIN_IDS, hyperEvm, monad } from '@latchprotocol/connect/chains'
```

`LATCH_CHAINS` offers **eleven** chains: ten mainnets (Ethereum, Base, BNB
Smart Chain, Linea, Ink, X Layer, HyperEVM, Monad, Plasma, Stable) and one
testnet, Ethereum Sepolia. Every entry takes its identity — name,
`nativeCurrency`, `blockExplorers` — from wagmi's curated registry; the one
field this package replaces is `rpcUrls.default.http`, which carries a probed,
fastest-first list of three to five public endpoints per chain
(`LATCH_PUBLIC_RPCS`).

Presence in `LATCH_CHAINS` means "verified EIP-1153 target", **not** "Latch is
live". Latch contracts are deployed on Ethereum Sepolia only; check
`LATCH_DEPLOYED_CHAIN_IDS` / `isLatchDeployedChain()` before any write.

### Defined but not offered

Monad Testnet (10143), Stable Testnet (2201) and Arc Testnet (5042002) are
**absent from `LATCH_CHAINS`**. Latch has no contracts on any of them and no
plan to deploy to a testnet other than Sepolia, so each was a switcher row that
could only lead somewhere empty — and, unlike a mainnet, with no roadmap value
to justify it.

Their definitions were kept, not deleted: the endpoints were genuinely probed,
and the exports are part of a published surface other people build against.
They are collected in `LATCH_UNLISTED_CHAINS`, and opting one back in is one
line:

```ts
import { LATCH_CHAINS, monadTestnet, createLatchConfig } from '@latchprotocol/connect'
createLatchConfig({ chains: [...LATCH_CHAINS, monadTestnet] })
```

### Audit surface

`UNVERIFIED_CHAIN_METADATA` (chains whose `nativeCurrency`/`blockExplorers` are
unverified) and `SINGLE_ENDPOINT_CHAIN_IDS` (chains with no RPC failover) are
both **empty** as of the 2026-09-10 probe, and exported as empty lists so a
release check can assert on them. `THIN_ENDPOINT_CHAIN_IDS` lists the chains
carrying fewer than five endpoints; its scope is every chain this package
*defines*, so it includes the unlisted Stable Testnet — intersect it with
`LATCH_CHAINS` if you only care about offered chains.

## Theme

```ts
import { latchTheme, LATCH_THEME, LATCH_COLORS } from '@latchprotocol/connect/theme'
```

`latchTheme({ accentColor?, accentColorForeground? })` returns a RainbowKit
`Theme` built by spreading RainbowKit's `darkTheme()` and overriding the fields
the Latch brand specifies. There is no light theme; the design defines none.
The raw brand tokens (`LATCH_COLORS`, `LATCH_FONTS`, `LATCH_RADII`,
`LATCH_SHADOWS`, `LATCH_SCRIM`, `LATCH_EASE`) are exported for hosts that need
matching values outside RainbowKit.

### Styling hooks

Every colour in `styles.css` is `var(--token, #fallback)`, so a host that
defines Latch's CSS tokens restyles the controls for free, and one that does
not still gets the brand.

- `--latch-connect-logo`: image shown before the connect-modal title. Defaults
  to `url('/brand/latch-mark-transparent.png')`; set to `none` to disable, or
  point it at your own asset.
- `--latch-connect-plug-mask`: optional mask image for the plug glyph on the
  disconnected button.

## Why a wrapper and not a fork

RainbowKit is MIT, so a rebranded fork would be legal. The cost is
maintenance, not licensing: RainbowKit carries a large set of wallet
connectors whose SDKs, and WalletConnect itself, change constantly. A fork
would make every future connector breakage and security fix ours, forever.
RainbowKit's theme API and `ConnectButton.Custom` already reach everything the
Latch brand needs, and the few behaviours the theme cannot express, such as
dropping WalletConnect rows when no project id is configured, are handled in
`createLatchConfig` by composing the wallet list ourselves.

This package is the seam. If RainbowKit ever cannot express something we need,
a fork replaces the internals of this package without touching its consumers.

## Build

```sh
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/, then copies src/styles.css -> dist/styles.css
```
