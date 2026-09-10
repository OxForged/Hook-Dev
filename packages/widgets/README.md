# @latchprotocol/widgets

Embeddable swap, liquidity and launch widgets for **Latch Protocol** — a Uniswap-v4-style singleton AMM with hooks, targeting EVM chains where Uniswap v4 is not deployed.

These widgets are built to live in **your** app. Not Latch's. If you run a DEX, an aggregator, a launchpad, a wallet or a portfolio tracker, you can drop one in, keep your own look, and **earn a share of every swap it routes**.

MIT licensed. The protocol's Solidity is GPL-2.0; this package is independently authored against the ABIs, so embedding it puts no licence obligation on your app.

---

## The part that matters: integrator fee attribution

Every widget takes an `integrator` config:

```tsx
<WidgetProvider
  adapter={adapter}
  integrator={{
    referrer: "0xYourFeeRecipient",  // where your cut lands
    feeBps: 25,                      // 0.25% of the swap output
  }}
>
  <SwapWidget />
</WidgetProvider>
```

That is the whole integration. From there:

- The fee is taken **in the output currency**, out of the swap's own vault credit.
- It is **an action inside the swap transaction**, not an off-chain accrual, not a claim you file later, not a number in a dashboard someone else controls. It settles atomically with the swap or the swap reverts.
- It is **shown to the user** as its own line in the summary, and the "minimum received" they are quoted is already net of it.

### How it reaches the chain

```text
UniversalRouter.execute([INFI_SWAP], [plan], deadline)

  plan (one vault lock):
    0. CL_SWAP_EXACT_IN_SINGLE   amountOutMinimum = minAmountOutGross
    1. SETTLE_ALL                pull the input currency from the user (via Permit2)
    2. TAKE_PORTION              feeBps of the output credit  ->  your referrer   ← your fee
    3. TAKE_ALL                  the remainder -> the user, floored at minAmountOutNet
```

`TAKE_PORTION` splits the vault credit before anything leaves the singleton, so the router never holds your fee and there is no window in which it can be swept.

The code path, end to end:

| Step | Where |
| --- | --- |
| You pass `integrator` | `<WidgetProvider integrator={...}>` |
| Validated once, at mount | [`validateIntegratorConfig`](src/config/integrator.ts) |
| Split out of the quote for display | [`buildQuoteBreakdown`](src/core/math.ts) |
| Threaded into the execution request | [`useSwapExecute`](src/hooks/useSwapExecute.ts) |
| Encoded as a `TAKE_PORTION` action | [`buildSwapCall`](src/callpath/swap.ts) |

There is no code path that swaps while dropping the fee, and none that encodes a fee that did not pass validation — `buildSwapCall` re-checks the bounds and refuses a hand-constructed config.

### Rules, and what happens when you break them

| Rule | On violation |
| --- | --- |
| `feeBps` is an integer | `IntegratorConfigError` — `FEE_BPS_NOT_AN_INTEGER` |
| `0 ≤ feeBps ≤ 100` (**`MAX_INTEGRATOR_FEE_BPS`**, 1.00%) | `FEE_BPS_ABOVE_MAX` |
| `feeBps > 0` requires a `referrer` | `REFERRER_MISSING` |
| `referrer` is a well-formed address | `REFERRER_MALFORMED` |
| `referrer` is not the zero address | `REFERRER_ZERO_ADDRESS` |

Every one of these **throws at provider mount**, not at swap time. A misconfigured widget refuses to render and tells you why, because the alternative — a widget that renders perfectly and quietly earns you nothing — is the failure mode you would not notice for a month.

`MAX_INTEGRATOR_FEE_BPS` is a client-side policy, not a contract limit (the on-chain `BipsLibrary` only rejects above 100%). It exists so no embedder can ship a widget that takes a third of a user's output and poisons the widget for everyone else.

### Fee modes

`feeMode: "take-portion"` (default) puts the split inside the swap plan, as shown above.

`feeMode: "pay-portion"` moves it to the router level — the swap takes its full output to the router, `PAY_PORTION` forwards your fee, `SWEEP` returns the rest. Use it when the fee has to be taken across a plan the periphery cannot express alone. It costs an extra command and gives the router temporary custody, so it is not the default.

### What is *not* fee-bearing

**Liquidity.** `TAKE_PORTION` splits an output currency; adding liquidity has no output, and removing it returns the user's own principal. Skimming that is a withdrawal charge, not a referral fee. The `integrator` config is still carried through the liquidity path so you can record attribution in analytics, but nothing is taken on-chain.

**Launches** pass `referrer` and `referrerFeeBps` as arguments to the launchpad's `buy`. See [Launch widget status](#launch-widget-status) — that interface is proposed, not deployed.

---

## Install

```bash
npm install @latchprotocol/widgets viem react react-dom
```

`react`, `react-dom` and `viem` are peer dependencies, so your app's copies are used. `wagmi` is an optional peer — the widgets never import it, and you can bridge any wallet stack through the adapter interface.

Requires React 18 or 19, Node 20+ for the build.

---

## Quick start

```tsx
import {
  WidgetProvider,
  SwapWidget,
  createViemAdapter,
  type ChainConfig,
} from "@latchprotocol/widgets";
import "@latchprotocol/widgets/styles.css"; // or let the widget inject it
import { createPublicClient, http } from "viem";

const chain: ChainConfig = {
  chainId: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  contracts: {
    vault: "0x...",
    clPoolManager: "0x...",
    binPoolManager: "0x...",
    universalRouter: "0x...",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  },
  blockExplorerUrl: "https://basescan.org",
};

const adapter = createViemAdapter({
  chain,
  publicClient: createPublicClient({ transport: http("https://your-own-rpc") }),
  wallet: {
    getAccount: async () => yourWallet.address ?? null,
    sendTransaction: (tx) => yourWallet.send(tx),
  },
  tokens: yourTokenList,
  pools: yourPoolList,
});

export function Swap() {
  return (
    <WidgetProvider
      adapter={adapter}
      integrator={{ referrer: "0xYourFeeRecipient", feeBps: 25 }}
      theme="system"
    >
      <SwapWidget />
    </WidgetProvider>
  );
}
```

---

## Headless vs styled

Two layers, two entry points. Pick the one that matches how much of the UI you want to own.

### Styled — `@latchprotocol/widgets`

Drop-in components: `<SwapWidget />`, `<LiquidityWidget />`, `<LaunchWidget />`. They render real form semantics, handle approvals and transaction states, and theme entirely through CSS custom properties.

### Headless — `@latchprotocol/widgets/headless`

Hooks and pure functions. No markup, no stylesheet, no `react-dom/client` — so none of it lands in your bundle.

```tsx
import {
  WidgetProvider,
  useSwapQuote,
  useSwapExecute,
} from "@latchprotocol/widgets/headless";

function MySwapForm({ tokenIn, tokenOut, amountIn }) {
  const { breakdown, status, rate } = useSwapQuote({ tokenIn, tokenOut, amountIn });
  const { execute, step, statusMessage, needsApproval, approve } = useSwapExecute({
    tokenIn, tokenOut, amountIn,
    quote: quote.quote, breakdown,
  });

  // breakdown.integratorFee is already split out. Render it however you like.
}
```

| | Headless | Styled |
| --- | --- | --- |
| Controllers (`useSwapQuote`, `useSwapExecute`, `useAddLiquidityQuote`, `useLaunchBuy`, …) | ✅ | ✅ |
| Quote math, formatting, call-path encoders | ✅ | ✅ |
| Adapters and config validation | ✅ | ✅ |
| Components and stylesheet | — | ✅ |

Going headless does **not** opt you out of fee validation: `WidgetProvider` validates the config, and the call-path builders refuse anything that did not come from it.

Available hooks: `useSwapQuote`, `useSwapExecute`, `useSlippageSetting`, `useAddLiquidityQuote`, `useAddLiquidityExecute`, `usePositions`, `useRemoveLiquidity`, `useLaunch`, `useLaunchList`, `useLaunchAccountState`, `useLaunchBuy`, `useTokenList`, `useTokenBalance`, `useAccount`, `usePools`, `usePoolState`.

---

## Non-React hosts

### Custom elements

```html
<script type="module">
  import { defineLatchWidgets } from "@latchprotocol/widgets/embed";
  defineLatchWidgets();
</script>

<latch-swap-widget
  theme="dark"
  integrator='{"referrer":"0xYourFeeRecipient","feeBps":25}'
></latch-swap-widget>

<script type="module">
  // A live adapter cannot come from an attribute (a viem transport is not JSON).
  document.querySelector("latch-swap-widget").adapter = myAdapter;
</script>
```

Three elements: `<latch-swap-widget>`, `<latch-liquidity-widget>`, `<latch-launch-widget>`. Each renders into a shadow root, so the widget's CSS cannot leak into your page and your CSS cannot break the widget — while `--latch-*` custom properties still inherit through the shadow boundary, which is exactly the theming behaviour you want.

For development, `adapter="mock"` plus a `chain='{...}'` attribute needs no JavaScript at all.

### Iframe bridge

For hosts that will not run third-party script in their own realm — a reasonable position when the script asks users to sign transactions.

The widget runs in the iframe and owns only rendering. It holds no keys and opens no RPC connections. Every chain read and write is a request to your page, which answers it with your adapter and your wallet.

```text
 iframe (widget)                         parent (your page)
 ────────────────                        ──────────────────
  ready ─────────────────────────────────▶
       ◀───────────────────────────── init { chain, integrator, theme, isMock }
  invoke { id, method, args } ───────────▶
       ◀────────── result { id, ok: true, value } | { id, ok: false, error }
  resize { height } ─────────────────────▶
  event  { name, payload } ──────────────▶
```

Every message carries `{ channel: "latch-widget", version: 1, type }`; anything else is ignored. Both sides pin the counterpart origin and check `event.origin` — never `"*"`, and never anything inside `data`, which is attacker-controlled. `BigInt` survives structured clone, so amounts cross the boundary as exact integers; nothing is stringified.

Host side:

```ts
import { serveWidgetIframe } from "@latchprotocol/widgets/embed";

const stop = serveWidgetIframe({
  iframe: document.querySelector("iframe#latch")!,
  widgetOrigin: "https://widgets.example",   // exact origin, never "*"
  adapter: myAdapter,
  widget: "swap",
  integrator: { referrer: "0xYourFeeRecipient", feeBps: 25 },
  approveTransaction(request) {
    // Last line of defence before you sign. The widget is still third-party code.
    return (
      request.to === MY_ROUTER &&
      request.integratorFee?.referrer === MY_FEE_RECIPIENT
    );
  },
});
```

Widget side (inside the iframe):

```ts
import { createIframeBridgeAdapter } from "@latchprotocol/widgets/embed";

const { adapter, init } = await createIframeBridgeAdapter({
  hostOrigin: "https://app.example",
});
```

**You are the security boundary.** Before signing, check that `to` is a contract you expect, that `value` matches what the user was shown, and that `integratorFee.referrer` is your address. This contract makes the widget *inspectable*, not trusted.

---

## Theming

Every colour, radius, font and spacing value is a `--latch-*` custom property declared on `.latch-widget`. Override one from your page and the widget follows — nothing is hardcoded inside a rule.

```css
.latch-widget {
  --latch-accent: #ff4d6d;
  --latch-accent-hover: #e04360;
  --latch-radius: 4px;
  --latch-font: "Your Brand Sans", system-ui, sans-serif;
  --latch-bg: var(--your-card-background);
  --latch-text: var(--your-body-colour);
}
```

Light and dark ship by default. `theme="light" | "dark" | "system"` on the provider; `system` follows `prefers-color-scheme`.

The full token set: `--latch-bg`, `--latch-bg-elevated`, `--latch-bg-sunken`, `--latch-border`, `--latch-border-strong`, `--latch-text`, `--latch-text-muted`, `--latch-text-inverted`, `--latch-accent`, `--latch-accent-hover`, `--latch-accent-text`, `--latch-success`, `--latch-warning`, `--latch-warning-bg`, `--latch-danger`, `--latch-danger-bg`, `--latch-focus`, `--latch-radius`, `--latch-radius-sm`, `--latch-font`, `--latch-font-mono`, `--latch-font-size`, `--latch-font-size-sm`, `--latch-font-size-lg`, `--latch-gap`, `--latch-padding`, `--latch-control-height`, `--latch-shadow`.

**Getting the stylesheet in:** either `import "@latchprotocol/widgets/styles.css"`, or do nothing — the styled components inject it once on mount. The web component always injects it into its own shadow root. All three come from one source (`src/styles/css.ts`), so they cannot drift.

**Narrow layouts.** The widgets are single-column and fluid from 280px up, with a tighter padding and type scale below 380px. They are meant to live in a 360px sidebar and are tested at that width.

---

## Chain configuration

Nothing in this package knows which chain you are on. There are no bundled RPC URLs and no address book — a hardcoded address is a bug that ships to every host. Everything arrives through `ChainConfig`:

```ts
interface ChainConfig {
  chainId: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  contracts: {
    vault: Address;               // required
    clPoolManager?: Address;      // at least one pool manager required
    binPoolManager?: Address;
    universalRouter?: Address;    // required to swap
    clPositionManager?: Address;  // required for CL liquidity
    binPositionManager?: Address; // required for bin liquidity
    permit2?: Address;            // required to pull the input token
    quoter?: Address;
    launchpad?: Address;
  };
  transport?: Transport;          // viem transport, if the adapter reads directly
  blockExplorerUrl?: string;
  defaultDeadlineSeconds?: number; // default 1200
}
```

`assertValidChainConfig` runs at provider mount. A missing address fails at the operation that needs it, naming both — `contracts.universalRouter is not configured, but it is required to execute a swap` — rather than surfacing as a decode error.

---

## The adapter boundary

Every chain read and write goes through one interface, `ProtocolAdapter` ([`src/adapters/protocol.ts`](src/adapters/protocol.ts)). No component, hook or controller imports a viem client directly.

### `createMockAdapter` — development only

> **No Latch Protocol contracts are deployed and there is no RPC endpoint.** The mock adapter exists so the widgets can be built and reviewed end to end. Everything it returns is invented.

Three things keep that from becoming a lie a user could act on:

1. `isMock` is `true` and **cannot be configured off**. The styled widgets render a permanent warning banner whenever it is set.
2. Every record carries `source: "mock"`.
3. The tokens are `MOCK-A`, `MOCK-B`, `MOCK-GAS`, `mUSD` — nothing that could be mistaken for a real asset — and `buildSwap` returns `data: "0x"`, so a mock transaction is not submittable even by accident.

The simulator is a plain constant-product curve. It is **not** the protocol's concentrated-liquidity or bin math and must never be used to predict a real fill.

```ts
const adapter = createMockAdapter({
  chain,
  account: "0x...",       // null to simulate a disconnected wallet
  latencyMs: 250,         // exercise loading states
  rejectTransactions: false,
  failQuotes: false,
});
```

### `createViemAdapter` — live

Produces real calldata and submits real transactions.

- **Encoding** is complete and unit-tested against the router and periphery sources.
- **Token, balance and allowance reads** are ordinary ERC-20 and Permit2 calls.
- **Pool discovery** is not on-chain — the singleton has no pool enumeration. Pass the pools you support, or wire an indexer (`@latchprotocol/sdk/indexer` describes the schema).
- **Quoting** needs a deployed quoter or a host-supplied `overrides.quoteSwap`. Without one it throws `UnsupportedOperationError` rather than inventing a number. **A fabricated quote is worse than no quote.**

The same applies to `getPoolState`, `listPositions`, `quoteAddLiquidity` and `quoteRemoveLiquidity`: supply an override or get a named error, never silent zeros. "There is no liquidity" and "I could not find out" must not render identically.

### Your own adapter

Implement `ProtocolAdapter` to route through your backend, your quoter, or wagmi. The widgets neither know nor care.

---

## Widgets

### Swap

Token in/out selection, amount entry with per-token decimal validation, live re-quoting, rate, price impact with severity, LP fee, the integrator fee line, minimum received, route summary, the two-step Permit2 approval flow, and full transaction states.

### Liquidity

Add and remove, for **both** pool types behind one interface:

- **Concentrated liquidity** — a tick pair, snapped to the pool's tick spacing, with widen/narrow controls.
- **Liquidity book** — a bin span around the active id, with a uniform distribution across it.

Both emit the same `LiquidityRange` union, so everything above the range editor — amounts, quote, approvals, execution — is identical. The divergence is confined to [`src/callpath/liquidity.ts`](src/callpath/liquidity.ts).

### Launch

Sale progress, amount raised against the hard cap, per-wallet cap remaining, time gates with a live countdown, and an inline price-curve chart (fixed, linear or exponential).

Every gate is evaluated by `evaluateLaunchPurchase` and surfaced as a specific reason — "Sale has not started yet", "You have reached the per-wallet cap" — on a disabled button, rather than as a reverted transaction the user pays for.

#### Launch widget status

**The launchpad ABI in [`src/callpath/launch.ts`](src/callpath/launch.ts) is a proposed interface, not a deployed contract.** Unlike the swap and liquidity paths — encoded against the real periphery and router sources in this repo — there is no launchpad in the tree to encode against. When one ships, either it implements this interface or that file changes. If you have your own sale contract, implement `buildLaunchBuy` in your adapter rather than bending this encoder.

---

## Accessibility

- Real `<form>` elements; submit works from the keyboard, and Enter in the amount field does what you expect.
- A `<label>` for every input, including visually-hidden labels on the token selectors.
- One `aria-live="polite"` region per widget. Quote refreshes and transaction transitions are **announced without moving focus**, so a background re-quote never yanks a keyboard user out of the amount field mid-typing.
- `role="alert"` for errors, `aria-invalid` + `aria-describedby` on invalid fields, `role="progressbar"` on the sale progress, `aria-busy` on in-flight buttons.
- Visible focus rings on every interactive element, using `--latch-focus`.
- `prefers-reduced-motion` respected.

---

## Development

```bash
npm install
npm run dev          # demo harness at http://localhost:5180
npm run typecheck    # tsc --noEmit, strict + noUncheckedIndexedAccess
npm test             # vitest
npm run build        # ESM + .d.ts + dist/styles.css
```

The harness renders all three widgets against the mock adapter, with live controls for the integrator fee, theme, wallet connection, a wallet that rejects, artificial latency, and a 360px sidebar toggle — plus the same swap widget rendered through the custom element. Set the fee and watch it appear in the summary and in the transaction the widget prepares.

Tests cover fee attribution (validation, rounding parity with `BipsLibrary.calculatePortion`, and that the fee is genuinely in the encoded calldata), quote math (including the property that a swap clearing the gross floor always leaves the user at or above the net floor), call-path encoding for both pool types, and the mock adapter's contract.

---

## Licence

MIT. See [LICENSE](LICENSE).

The protocol's core contracts are GPL-2.0-or-later. This package is independently authored from the compiled ABIs and contains no Solidity source, so building against it carries no obligation from the contracts' licence.
