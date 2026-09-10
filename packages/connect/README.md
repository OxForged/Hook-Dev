# @latchprotocol/connect

The wallet layer for Latch Protocol: a thin, Latch-themed wrapper over
[RainbowKit](https://rainbowkit.com) and [wagmi](https://wagmi.sh), plus
`defineChain` entries for every Latch target chain that wagmi does not ship.

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

A menu over wagmi's `useSwitchChain`. By default (`onlyDeployed: true`) it
lists only chains where Latch contracts are actually deployed; other target
chains, when shown, are tagged `target`.

| Prop           | Default | Notes                                       |
| -------------- | ------- | ------------------------------------------- |
| `onlyDeployed` | `true`  | falls back to the full list if it would be empty |
| `grouped`      | `true`  | Mainnet / Testnet sections                  |
| `onSwitch`     |         | `(chainId: number) => void` after a successful switch |
| `className`    |         |                                             |

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

Eleven chains. Four come from wagmi's registry unchanged (`mainnet`, `base`,
`bsc`, `sepolia`); seven are defined here (`hyperEvm`, `monad`, `plasma`,
`stable`, `monadTestnet`, `stableTestnet`, `arcTestnet`).

Presence in `LATCH_CHAINS` means "verified EIP-1153 target", **not** "Latch is
live". Latch contracts are deployed on Ethereum Sepolia only; check
`LATCH_DEPLOYED_CHAIN_IDS` / `isLatchDeployedChain()` before any write.

The seven package-defined chains carry documentation-sourced `nativeCurrency`
values and no `blockExplorers`; their ids are listed in
`UNVERIFIED_CHAIN_METADATA` so a release check can assert on them. Six chains
have exactly one public RPC (`SINGLE_ENDPOINT_CHAIN_IDS`), so there is no
failover unless you supply your own `transports`.

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
