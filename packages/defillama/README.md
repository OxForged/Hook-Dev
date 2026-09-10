# Latch Protocol - DefiLlama adapters

Staging area for the three adapters DefiLlama needs from Latch: **TVL**, **swap
volume** and **fees**. The directory layout mirrors the two upstream repositories
so the files that ship are the files that were tested here - nothing is rewritten
on the way out.

> **Status: not submittable yet.** Latch is deployed only on Sepolia, and DefiLlama
> does not index testnets. Both adapters therefore export **zero chains** today.
> Filling in one mainnet row in the config tables is all that is required to change
> that - see [Adding a chain](#adding-a-chain).

---

## What is here

```
packages/defillama/
├── dimension-adapters/                 mirrors DefiLlama/dimension-adapters
│   ├── dexs/latch.ts                   ★ SUBMIT: volume + fees, one adapter
│   ├── adapters/types.ts               harness stub
│   └── helpers/{chains,lists,prices}.ts, coreAssets.json   harness stubs
│
├── DefiLlama-Adapters/                 mirrors DefiLlama/DefiLlama-Adapters
│   ├── projects/latch/index.js         ★ SUBMIT: TVL
│   ├── projects/latch/config.js        ★ SUBMIT: deployment registry
│   ├── projects/helper/**              harness stubs
│   ├── _harness/chainApi.js            harness only
│   └── package.json                    harness only (marks the tree CommonJS)
│
├── harness/                            runs the adapters against a real node
│   ├── balances.ts                     minimal @defillama/sdk Balances
│   ├── rpc.ts                          eth_getLogs + viem decoding
│   ├── runFetch.ts                     assembles a FetchOptions
│   └── sepolia.ts                      the one live deployment
│
├── scripts/run-sepolia.ts              end-to-end run, all three dimensions
└── test/                               48 tests, 9 of them against live chain
```

Only the four files marked ★ are meant to leave this package. Everything else is
local scaffolding, and every stub file says so in its header. The stubs exist for
one reason: so the adapters can be *executed*, against a real chain, before anyone
is asked to trust them.

---

## Where the addresses live

Two config tables, one per upstream repo, because the repos cannot import from
each other:

| File | Consumed by |
|---|---|
| `dimension-adapters/dexs/latch.ts` → `chainConfig` | volume + fees |
| `DefiLlama-Adapters/projects/latch/config.js` → `DEPLOYMENTS` | TVL |

`test/conventions.test.ts` fails the build if the two disagree on any address,
block or start date, so the duplication cannot silently drift.

The live Sepolia deployment is **not** in either table. It lives in
`harness/sepolia.ts` and is injected only by the local harness, so a testnet can
never leak into a submitted adapter.

### Current deployment (Sepolia, chain id 11155111)

| Contract | Address |
|---|---|
| Vault | `0xCe3d133eb486b448A53437A5073619FbE424d01B` |
| CLPoolManager | `0xb7C8a11E0B359616eD06256783aF57114841F738` |
| BinPoolManager | `0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3` |
| LatchProtocolFeeController | `0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9` |

Vault deployed at block 11672508 (2026-09-10T04:09:12Z).

---

## Adding a chain

1. **Fill in the row in both config tables.** Every target chain already has a
   placeholder row with empty addresses; a chain with no `vault`, no pool manager
   or no `start` is filtered out by `isConfigured()` and never exported.

   ```ts
   // dimension-adapters/dexs/latch.ts
   [CHAIN.BASE]: {
     vault: "0x…",
     clPoolManager: "0x…",
     binPoolManager: "0x…",
     fromBlock: 12345678,   // block of the FIRST pool-manager deployment
     start: "2026-11-01",   // first date that returns data, YYYY-MM-DD
     blacklistTokens: getDefaultDexTokensBlacklisted(CHAIN.BASE),
   },
   ```

   ```js
   // DefiLlama-Adapters/projects/latch/config.js  -- same numbers, plus chainId
   base: { chainId: 8453, vault: "0x…", clPoolManager: "0x…", binPoolManager: "0x…",
           protocolFeeController: "0x…", fromBlock: 12345678, start: "2026-11-01" },
   ```

2. **Run the tests.** `npm test` checks parity between the two tables, that the
   slug is a real `CHAIN` enum value, and that `start` is a `YYYY-MM-DD` string.

3. **Point the harness at it** to get a real number before submitting:
   set `LATCH_RPC_<chainId>` and adapt `scripts/run-sepolia.ts`, or add a live
   test alongside `test/sepolia.live.test.ts`.

No adapter logic changes. Both files iterate their config table.

Pre-wired target chains and their DefiLlama slugs (all verified against upstream
`helpers/chains.ts`): Ethereum `ethereum`, Base `base`, BSC `bsc`, HyperEVM
**`hyperliquid`** (not `hyperevm`), Monad `monad`, Plasma `plasma`, Stable
`stable`.

---

## Running and testing

```bash
cd packages/defillama
npm install

npm run typecheck      # tsc --noEmit
npm test               # vitest; hits Sepolia over a public RPC
npm run run:sepolia    # end-to-end: volume, fees and TVL against the live chain
LATCH_SKIP_LIVE=1 npm test    # offline: skips every live-chain test
```

`npm run run:sepolia [blocks]` takes an optional lookback in blocks; with no
argument it scans the whole deployment history.

A custom RPC can be supplied with `LATCH_RPC_11155111`. The default public
endpoint caps `eth_getLogs` at 50 000 blocks and the harness pages accordingly.

### Testing the real thing, upstream

Once the files are copied into the upstream repos, their own runners take over:

```bash
# DefiLlama-Adapters
node test.js projects/latch/index.js
node test.js projects/latch/index.js 2026-09-15

# dimension-adapters
pnpm test dexs latch 2026-09-15
DEBUG_BREAKDOWN_FEES=1 pnpm test dexs latch 2026-09-15
pnpm run ts-check
```

---

## Methodology

### TVL - the Vault, not the pools

Latch is a Uniswap-v4-style singleton forked from PancakeSwap Infinity. A single
`Vault` custodies **every** token in the protocol; `CLPoolManager` and
`BinPoolManager` register with it as "apps" and hold nothing. So TVL is the Vault's
token balances - there is no set of per-pool contracts to enumerate, and reading
balances off a pool manager returns zero.

This is checked, not assumed. `test/tvl.live.test.ts` asserts on live Sepolia that
both pool managers hold exactly `0` of each pool token while the Vault holds the
lot, and that `Vault.reservesOfApp(clPoolManager, token)` equals the Vault's whole
ERC20 balance.

What still has to be enumerated is *which* tokens to ask about. That comes from the
`Initialize` logs of both pool managers, which carry `currency0`/`currency1` for
every pool ever created. The token set is then summed against the Vault with
`sumTokens2({ api, ownerTokens, permitFailure: true })`, chunked 1000 at a time.
Native currency is the zero address in a pool key, and `sumTokens2` routes
`nullAddress` to `eth_getBalance`, so it needs no special case. Pools with a
non-null `hooks` address additionally get their pair summed against the hook, since
Latch hooks can take their own delta - the same treatment `projects/uniswap-v4`
gives them.

### Volume

Gross input of every swap, one leg per swap, from both pool managers.
`helpers/prices.addOneToken` picks the core-asset leg so a thin long-tail token
cannot set the USD value, and takes the absolute value of the signed `int128`
amounts.

### Fees - and how they map onto DefiLlama's income statement

`Swap` carries two numbers, both in pips (1e-6):

- **`fee`** (`uint24`) - the *total* rate charged on the gross input, protocol fee
  included. This is `SwapState.swapFee` in both `CLPool` and `BinPool`.
- **`protocolFee`** (`uint16`) - the *single-direction* protocol fee, already
  resolved for this swap's direction.

The protocol fee comes off the input **first** and the LP fee applies to the
remainder, so the two compose rather than add
(`ProtocolFeeLibrary.calculateSwapFee`):

```
fee = protocolFee + lpFee − (protocolFee × lpFee / 1e6)
```

which means the amounts decompose exactly, with no need to recover `lpFee` at all:

```
totalFee    = grossInput × fee                 / 1e6
protocolCut = grossInput × protocolFee         / 1e6
lpCut       = grossInput × (fee − protocolFee) / 1e6
```

`protocolCut` is exactly what `CLPool.swap` accrues
(`(step.amountIn + step.feeAmount) * protocolFee / 1e6`, summed over steps) and
what `BinPool.swap` reaches the long way round via
`PackedUint128Math.getProtocolFeeAmt` (`totalFee * protocolFee / swapFee`).

| DefiLlama key | Latch | Why |
|---|---|---|
| `dailyFees` | total swap fee | Gross Protocol Revenue: everything Latch *could* keep if it set the protocol fee to the whole swap fee. `fee` already includes the LP share, so this is one field. |
| `dailyUserFees` | same | Swappers pay all of it. LPs are not charged, and there is no borrow/mint/redeem fee anywhere in the protocol. |
| `dailySupplySideRevenue` | `fee − protocolFee` | Cost of Funds: stays in the pool and accrues to LP positions. |
| `dailyRevenue` | `protocolFee` | Gross Profit. Accrues into `protocolFeesAccrued` on the pool manager, withdrawable by its owner through `Vault.collectFee`. Equals `dailyFees − dailySupplySideRevenue` by construction. |
| `dailyProtocolRevenue` | same as `dailyRevenue` | All of it goes to the treasury. |
| `dailyHoldersRevenue` | **omitted** | Latch has no token. There is no buyback, burn or holder distribution to attribute, and reporting `0` for a mechanism that does not exist is noise. |

`dailyFees = dailyRevenue + dailySupplySideRevenue` holds per swap, not just in
aggregate, because all three are booked against the same leg.

**Known approximation.** The fee is charged on the input leg only, so booking it in
the input token is what the contracts do. The adapter instead applies the same
*rate* to whichever leg `addOneToken` prices, exactly as `dexs/pancakeswap-infinity`
does. The two legs of a swap differ only by the fee itself and price impact, so the
USD value is the same to within that, and pricing off the core asset is what stops
a long-tail token from setting the number.

**Not tracked.** `Donate`, hook-charged fees (a hook may take its own delta and
charge whatever it likes; that is the hook's revenue, not Latch's), and bin
composition fees on `Mint`. Each would need its own event stream and none exists in
volume today.

---

## Two things that will bite anyone editing this

### 1. topic0 collisions

Vault + CLPoolManager + BinPoolManager + the shared `ProtocolFees` base declare
**34 events but only 22 distinct signatures**. Six signatures are byte-identical
across contracts and therefore share a topic0:

| Signature | Emitted by |
|---|---|
| `OwnershipTransferred(address,address)` | Vault, CL, Bin, ProtocolFees |
| `DynamicLPFeeUpdated(bytes32,uint24)` | CL, Bin |
| `Paused(address)` | CL, Bin, ProtocolFees |
| `ProtocolFeeControllerUpdated(address)` | CL, Bin, ProtocolFees |
| `ProtocolFeeUpdated(bytes32,uint24)` | CL, Bin, ProtocolFees |
| `Unpaused(address)` | CL, Bin, ProtocolFees |

Not hypothetical: the four Sepolia deployment transactions emit
`OwnershipTransferred` from all four addresses.

`Swap` and `Initialize` happen *not* to collide, because CL and Bin carry different
parameter types - but nothing guarantees that survives the next contract revision.
**Every log query in both adapters is scoped by emitting address**
(`getLogs({ target: <one pool manager>, eventAbi })`) and decoded with that
contract's own ABI. A `noTarget` scan keyed on topic0 alone would merge CL and Bin
activity and pick up a third contract's events for free.
`test/adapter.test.ts` asserts this: every query carries a `target`, never bare
`topics`, and the CL ABI is never sent to the Bin manager or vice versa.

Regenerate the counts from the compiled ABIs:

```bash
cd ../core/foundry-out && node -e "
const fs=require('fs'), f={Vault:'Vault.sol/Vault.json',CLPoolManager:'CLPoolManager.sol/CLPoolManager.json',BinPoolManager:'BinPoolManager.sol/BinPoolManager.json',ProtocolFees:'ProtocolFees.sol/ProtocolFees.json'};
let n=0; const s=new Map();
for (const [k,p] of Object.entries(f)) for (const e of JSON.parse(fs.readFileSync(p)).abi.filter(x=>x.type==='event')) {
  n++; const sig=e.name+'('+e.inputs.map(i=>i.type).join(',')+')'; s.set(sig,(s.get(sig)||[]).concat(k)); }
console.log(n,'declarations,',s.size,'unique');
for (const [sig,c] of s) if (c.length>1) console.log(' ', c.join(','), sig);"
```

### 2. `PackedUint128Math`

Bin `Mint` and `Burn` emit `bytes32[] amounts`: each word packs two `uint128`.
From `PackedUint128Math.sol`:

```
encode:  z  := or(and(x1, MASK_128), shl(128, x2))
decode:  x1 := and(z, MASK_128)      // LOW  128 bits
         x2 := shr(128, z)           // HIGH 128 bits
```

Which half is which token is pinned by `BinPoolManager`, not by the library:

```solidity
protocolFeesAccrued[key.currency0] += feeAmountToProtocol.decodeX();  // low  -> amount0
protocolFeesAccrued[key.currency1] += feeAmountToProtocol.decodeY();  // high -> amount1
```

`decodePackedUint128()` in `dexs/latch.ts` implements exactly this, and
`test/binPacking.test.ts` checks it against vectors taken from the protocol's own
`PackedUint128Math.t.sol` (19 tests, all passing under `forge test`). Getting the
halves backwards would swap the two tokens of every bin position - a confidently
wrong number, which is the worst kind.

The swap path does not need it: bin `Swap` carries plain `int128 amount0/amount1`.
It is exported for whoever extends this to bin liquidity flow.

---

## What has and has not been verified

**Verified against the live Sepolia deployment** (`npm test`, 9 live tests):

- all four addresses have bytecode;
- `Vault.isAppRegistered()` is true for both pool managers;
- the Vault holds every pool token and both pool managers hold exactly zero, with
  `reservesOfApp` matching the Vault's ERC20 balance;
- `LatchProtocolFeeController.defaultFee()` returns `(true, 1000, 1000)` - 0.1% in
  both directions - and `feesDisabled()` is false;
- the `Swap` and `Initialize` signatures in the adapters decode real logs (a wrong
  signature returns an empty array and would pass a weaker test silently);
- both real swaps carry `fee = 3997`, `protocolFee = 1000`; inverting the
  composition formula recovers `lpFee = 3000` exactly, i.e. a 0.30% tier under the
  0.1% protocol fee;
- over the fixed historical window 11672619-11672630 the adapter reproduces volume,
  fees and the LP/protocol split **to the wei**;
- the TVL adapter's output equals a direct `balanceOf` on the Vault.

**Not verified, and cannot be from here:**

- **any USD figure.** The harness has no price feed by design. Volume, fees and TVL
  are raw token units of two testnet tokens (`ltUSD`, `ltETH`) that nothing prices.
- **any mainnet.** Nothing is deployed. The seven mainnet config rows are empty
  placeholders and have never executed.
- **meaningful magnitudes.** The only Sepolia activity is one pool, two swaps and a
  couple of liquidity operations, evidently from a setup script. Nothing in this
  package should be read as a production metric, and no sample output here is a
  forecast of one.
- **the bin pool path end to end.** `BinPoolManager` has no pools yet, so the bin
  `Initialize`/`Swap` branch has only ever been exercised against synthetic logs in
  `test/adapter.test.ts` and against a live query that correctly returned zero
  results. The ABIs come straight from the compiled artifacts, but no real bin swap
  has ever been decoded.
- **upstream CI.** These files have not been run by `pnpm test dexs latch` or
  `node test.js` in the real repositories, because the real repositories' helper
  implementations (caching, multicall, pricing) are stubbed here.

---

## Conventions followed, and where they were confirmed

Everything below was read from the upstream repos on 2026-09-09, not from memory.

| Convention | Source |
|---|---|
| Volume and fees ship as **one** adapter file, not two | `dexs/pancakeswap-infinity.ts` and `dexs/uniswap-v4.ts` both return `dailyVolume` *and* the fee keys; there is no `fees/uniswap-v4.ts` or `fees/pancakeswap-infinity.ts`. Root `AGENTS.md`: "One simple adapter per listing; avoid multi-adapter breakdown wrappers." |
| `version: 2`, explicit `pullHourly` | `AGENTS.md` § Adapter Version |
| `fetch(options)`, single argument, no `timestamp` in the result | `AGENTS.md` § Fetch signature |
| Per-chain config object passed as `adapter: chainConfig` | `AGENTS.md` § Adapter shape, option 3 |
| `start` as `'YYYY-MM-DD'` | `adapters/types.ts` → `BaseAdapterChainConfig`; same migration in DefiLlama-Adapters (`utils/scripts/stringTimestamp.js`) |
| `getLogs({ target, eventAbi })`, human-readable ABI, never raw `topics`, never `noTarget` | `AGENTS.md` § getLogs / event handling |
| `cacheInCloud: true` only for the genesis pool-list scan | `AGENTS.md`; same use in `dexs/pancakeswap-infinity.ts` |
| One side of the swap only, gross of fees, via `addOneToken` | `dexs/AGENTS.md`; `helpers/prices.ts` |
| `methodology` keyed by **display** names; `breakdownMethodology` for every label | root `AGENTS.md` § Breakdown Labels |
| Income statement: `Fees = Revenue + SupplySideRevenue`, `Revenue = ProtocolRevenue + HoldersRevenue` | root `AGENTS.md` § Income Statement Mapping |
| Chain slugs from `helpers/chains.ts` (`hyperliquid`, not `hyperevm`; no `sepolia`) | `helpers/chains.ts` |
| TVL: per-chain `{ tvl, start }`, no root-level `tvl` | `projects/helper/whitelistedExportKeys.json`; `projects/fluid-dex/index.js` |
| TVL: `getLogs2` → token set → `sumTokens2({ ownerTokens })`, native as `nullAddress` | `projects/uniswap-v4/index.js`, `projects/pancakeswap-infinity/index.js`, `projects/helper/unwrapLPs.js` |

One deliberate divergence: `projects/uniswap-v4/index.js` gates its `tvl` behind
`getEnv('IS_RUN_FROM_CUSTOM_JOB')` because it is a heavy protocol. Latch is not -
one `Initialize` scan and one balance read per token - so that gate is not copied,
and `isHeavyProtocol` is not set.

---

## Before submitting

- [ ] At least one mainnet row filled in, in **both** config tables.
- [ ] `npm test` and `npm run typecheck` green.
- [ ] Real website and Twitter URLs in the header of `dexs/latch.ts` (currently
      placeholders).
- [ ] Copy only the ★ files; leave every harness stub behind.
- [ ] PR body answers what `AGENTS.md` says every review asks: is a 0-volume day
      correct, why do the numbers differ from Latch's own dashboard, has the fee
      split ever changed and when.
- [ ] Note in the PR that server-side wiring (`dimensions: { dexs: "latch", fees:
      "latch" }` in defillama-server) is a separate follow-up.
