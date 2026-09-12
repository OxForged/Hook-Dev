# __LATCH_APP_NAME__

A DEX and launchpad front end running on LatchProtocol's **shared core**.

```
npm install
npm run latch:verify     # read every configured address back off the chain
npm run dev
```

Then edit **`latch.config.ts`**. That is the whole configuration surface: chain,
fee wallet, branding, feature flags, token list. There is no Solidity in this
project and nothing else needs touching to go to market.

---

## Shared core, not a full fork

You are not deploying an AMM. `Vault`, both pool managers, the Universal Router,
the position managers and the quoter are already deployed and verified on chain
`__LATCH_CHAIN_ID__`; this app points at them. Your pools live in Latch's Vault.

**What that buys you.** No nineteen-contract deployment. No verification. No
audit question about contracts you did not write and cannot afford to review.
Every pool you create is visible to every other app on the same core, and every
pool they create is visible to you — the liquidity compounds instead of
fragmenting.

**What it costs you.** Latch's protocol fee applies to swaps on these pools. It
is set by Latch governance on the shared pool manager and **capped at 0.4%
(4000 pips) by core**, which is a hard limit in the contract rather than a
policy anyone can revise upward. You cannot change it, and it is frequently
zero. The Fees screen reads the live value; do not take a number from this
README.

**A full fork is allowed and owes nothing.** The core contracts are
GPL-2.0-or-later, so you may deploy your own Vault and pool managers, set your
own protocol fee controller, and pay Latch nothing at all. That is a legitimate
choice and nobody will stop you. It is the harder road: nineteen contracts to
deploy and verify per chain, an empty registry, no shared liquidity, and every
future core fix is yours to port. If you take it, set `chain.contracts` in
`latch.config.ts` to your own addresses and this front end will read them
instead. Nothing else changes.

---

## Licensing — what you may close-source

| Layer | Licence | Yours to close-source? |
|---|---|---|
| **This project** — everything in this repository | **MIT** | **Yes.** Fork it, restyle it, sell it, keep it private. |
| `@latchprotocol/sdk`, `@latchprotocol/widgets`, `@latchprotocol/connect` | MIT | Dependencies, not derivative works of the contracts. |
| Latch core, periphery, router, and Latch's own hooks | **GPL-2.0-or-later** | No. Derivatives of `infinity-core`. If you fork them, your fork is GPL. |

The reason this app can be MIT while it talks to GPL contracts is that **it talks
to them through their ABIs.** An ABI call is not linking and does not create a
derivative work. That analysis holds only while it stays true, so there is one
rule to keep:

> **Never import GPL Solidity, or code generated from GPL Solidity, into this
> project.** Not the sources, not a build artifact, not a hex bytecode string.

Concretely: `npm run latch:deploy -- --own-kit` prints a `forge` command rather
than deploying a kit for you, and that refusal is this rule being enforced, not
a missing feature. The GPL code stays where it is GPL; you fetch it, build it,
deploy it, and this front end stays MIT and yours.

---

## Your revenue

`fee` in `latch.config.ts`:

```ts
fee: {
  wallet: '0xYourTreasury',
  bps: 25,                 // 0.25% of the swap OUTPUT
  mode: 'take-portion',
},
```

The fee is a `TAKE_PORTION` action inside the swap's own call path, built by
`@latchprotocol/widgets`. It is paid in the same transaction as the swap, from
the output currency, before anything leaves the singleton — so nothing is
escrowed, owed, or reconciled later. Either the fee lands atomically with the
swap or the whole transaction reverts.

**Ceiling: 100 bps (1%).** The widgets package refuses to encode more. That is a
client-side policy rather than a contract limit, and it exists so no integrator
can quietly take a third of a user's output and poison the widget for everyone
else.

**It stacks on two fees you do not control**: the pool's LP fee (set by whoever
created the pool) and Latch's protocol fee. All three are disclosed on the Fees
screen, read live. Disclosing one of three is misleading by omission, so please
do not remove that screen.

There is **no fee on launches**. `LaunchpadKit` has no treasury and no fee
recipient — it reverts if you send it any native value beyond the exact
liquidity being seeded — and the launch tax accrues to in-range liquidity
providers through core rather than to the launchpad. If you want to charge for
launches you need your own contract in front of the kit; the kit will not do it
for you and this app does not pretend otherwise.

---

## The launchpad half is not live yet

Be aware of this before you plan around it. **Latch has no shared `LaunchpadKit`
deployed on any chain** as of this template's release — the mainnet deploy
script has only ever been dry-run, and no `LaunchGuardHook` is live either. So
`chain.launchpadKit` starts as `null` and every launch surface renders an
explicit "not configured" state rather than an empty list, because "no
launchpad" and "no launches" are different facts.

Two honest options today:

1. **Ship the DEX first.** Set `features.launchpad: false`. The launch screens
   disappear rather than sitting there broken.
2. **Deploy your own kit.** `npm run latch:deploy -- --own-kit` prints exactly
   how, then `npm run latch:deploy -- --kit 0x…` verifies it and writes it into
   your config.

When Latch ships a shared instance, pointing at it is one `--kit` away.

---

## No invented data

Every figure this app renders was read from the chain it is configured for. That
is not a style preference: each screen exists to help somebody decide whether to
trust a contract in their swap path, and a number that looks real and is not
poisons that judgement with no way for the reader to tell which numbers to
discount.

The rules, if you extend this app:

- **If you cannot read it, do not render it.** Say what is missing and why.
- **Four states, visually distinct**: loading, error, empty, not-configured.
  `src/components/States.tsx` has all four. On error, say the chain is
  unreachable — never fall back to an example.
- **No dollar figures.** Token units with a symbol, always. Nothing here prices
  these tokens, and inventing a price to produce a headline is the specific
  failure this rule exists to prevent.
- **Label the provenance.** A pool list is a log scan over a block range, not an
  enumeration. `<Provenance>` says which range. Do not tidy that away.
- **Disclose capability, never rate safety.** The pool table says what a hook
  is *able* to do, from its permission bitmap. It does not say whether the hook
  is safe, because this app cannot know that and neither can a registry listing.

---

## What is in here

```
latch.config.ts          the one file you edit
index.html
src/
  config/types.ts        the config's shape, documented field by field
  config/deployments.ts  Latch's shared core, per chain
  config/resolve.ts      validation — problems are rendered, never thrown
  lib/                   chain reads: pools, tokens, launches, fees
  components/States.tsx  the four data states
  routes/                Swap · Pools · Launch · Launch wizard · Fees
  theme.ts               latch.config.ts colours -> CSS custom properties
scripts/
  latch-verify.mjs       read every configured address back off chain
  latch-deploy.mjs       resolve and write addresses; never sends a transaction
```

## Deploying the front end

`npm run build` produces a static `dist/`. Host it anywhere. There is no server,
no API key and no backend: the app talks to public RPC endpoints probed by
`@latchprotocol/sdk`, and you can put your own dedicated endpoint in front of
them with `VITE_RPC_URL`.

Set `VITE_WALLETCONNECT_PROJECT_ID` if you want WalletConnect wallets in the
connect modal. Without it those rows are omitted entirely rather than offered
and then failing at relay time.
