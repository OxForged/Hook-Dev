# Latch Protocol - DefiLlama adapters

Staging area for the three adapters DefiLlama needs from Latch: **TVL**, **swap
volume** and **fees**. The directory layout mirrors the two upstream repositories
so the files that ship are the files that were tested here - nothing is rewritten
on the way out.

> **Status: one mainnet row, Robinhood Chain (4663), exporting an honest nothing.**
> Both adapters export `robinhood` - DefiLlama's own slug for the chain, present in
> both upstream repos and in the published `@defillama/sdk` provider list, all
> checked 2026-09-12. What they report today is **$0 TVL and no volume**, and that is
> correct: the only pool with any history is LTT1/LTT2, two Latch test tokens that
> nothing prices, and the adapters exclude them by address on purpose. The numbers
> become non-zero the day a pool in real assets (WETH, USDG, native ETH - all three
> priced by DefiLlama on this chain) sees a deposit or a swap.
>
> Whether DefiLlama will merge a listing whose first reading is zero is their
> editorial call, not a property of this code. See
> [What blocks listing](#what-blocks-listing-and-what-does-not).

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
│   ├── rpc.ts                          eth_getLogs + viem decoding, quota-aware
│   ├── runFetch.ts                     assembles a FetchOptions
│   ├── robinhood.ts                    the live mainnet: RPC, range cap, measured facts
│   └── sepolia.ts                      the testnet, injected by the harness only
│
├── scripts/run-robinhood.ts            end-to-end run against the mainnet, nothing injected
├── scripts/run-sepolia.ts              same against Sepolia
└── test/                               68 tests, 18 of them against live chains
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
block, start date or excluded token, so the duplication cannot silently drift. It
also pins the export to exactly `["robinhood"]`, so a placeholder row that
accidentally satisfies `isConfigured()` cannot slip out, and adding a chain is a
deliberate act that touches the test.

The Sepolia deployment is **not** in either table. It lives in
`harness/sepolia.ts` and is injected only by the local harness, so a testnet can
never leak into a submitted adapter.

### Live: Robinhood Chain (chain id 4663, slug `robinhood`)

| Contract | Address | Deployed at block |
|---|---|---|
| Vault | `0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c` | 60122218 |
| CLPoolManager | `0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66` | **60124455** (`fromBlock`) |
| BinPoolManager | `0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979` | 60124601 |
| LatchProtocolFeeController | `0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c` | wired to both managers 2026-09-12 |
| RevShareHook (retired) | `0x23CE34E8199927DD270dddd8579c947542bDE446` | holds the only pool |
| RevShareHook (current) | `0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2` | no pools yet |

Deployment blocks were measured with `eth_getCode` binary-searched by block on
2026-09-12, not copied from a script log. The timelocks landed earlier still, at
60111836 - the `deployedAtBlock` the dapp scans from - which is a valid but wider
floor. `start` is `2026-09-11`, the UTC day the pool managers landed.

Excluded by address on this chain (`LATCH_TEST_TOKENS`, both tables):

| Token | Address | Why |
|---|---|---|
| LTT1 | `0x2A21c0826848f2D597B7C87A4B931dE1407958A6` | Latch Test Token One, 18 dec |
| LTT2 | `0xa29927045BDFfd61B8F539D491085F1b6f7A8bE4` | Latch Test Token Two, 18 dec |

Real assets on the chain, all priced by DefiLlama (`coins.llama.fi`, confidence
0.99 on 2026-09-12) and all in upstream `coreAssets.json` under `robinhood`:
WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (18 dec), USDG
`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (**6 dec**), native ETH. Decimals are
upstream's concern when it prices a raw balance, but they matter to anyone reading
the harness output: a USDG amount is 10^12 smaller in raw units than the same
dollar value in WETH.

### Testnet: Sepolia (chain id 11155111)

| Contract | Address |
|---|---|
| Vault | `0xCe3d133eb486b448A53437A5073619FbE424d01B` |
| CLPoolManager | `0xb7C8a11E0B359616eD06256783aF57114841F738` |
| BinPoolManager | `0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3` |
| LatchProtocolFeeController | `0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9` |

Vault deployed at block 11672508 (2026-09-10T04:09:12Z).

---

## Adding a chain

0. **Confirm DefiLlama has a slug for the chain before anything else.** Read
   `helpers/chains.ts` in dimension-adapters and `projects/helper/chains.json` in
   DefiLlama-Adapters, and check the published `@defillama/sdk` provider list
   (`https://unpkg.com/@defillama/sdk@latest/build/providers.json`) has RPCs for
   it. A slug that is missing from any of the three means the adapter cannot list
   no matter how correct it is, and the work moves upstream. Copy the member into
   the local `helpers/chains.ts` stub with the date you read it; never add one from
   memory. Robinhood passed all three on 2026-09-12.

1. **Fill in the row in both config tables.** Every target chain already has a
   placeholder row with empty addresses; a chain with no `vault`, no pool manager
   or no `start` is filtered out by `isConfigured()` and never exported. Measure
   `fromBlock` with `eth_getCode` by block, not from a deploy log.

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
   slug is a real `CHAIN` enum value, that `start` is a `YYYY-MM-DD` string, and
   that the export list is exactly what you expect - update the pinned list in
   `test/conventions.test.ts` as part of the same change.

3. **Point the harness at it** to get a real number before submitting:
   set `LATCH_RPC_<chainId>` and copy `scripts/run-robinhood.ts`, and add a live
   test alongside `test/robinhood.live.test.ts` with a FIXED historical window.

No adapter logic changes. Both files iterate their config table.

Pre-wired target chains and their DefiLlama slugs (all verified against upstream
`helpers/chains.ts`): Robinhood **`robinhood`** (live), Ethereum `ethereum`, Base
`base`, BSC `bsc`, HyperEVM **`hyperliquid`** (not `hyperevm`), Monad `monad`,
Plasma `plasma`, Stable `stable`.

---

## Running and testing

```bash
cd packages/defillama
npm install

npm run typecheck      # tsc --noEmit
npm test               # vitest; hits Robinhood and Sepolia over public RPCs
npm run run:robinhood  # end-to-end against the mainnet, the real config row
npm run run:sepolia    # same against Sepolia, injected by the harness
LATCH_SKIP_LIVE=1 npm test    # offline: skips every live-chain test
```

Both run scripts take an optional lookback in blocks; with no argument they scan
the whole deployment history. On Robinhood that is ~120 paged `eth_getLogs`
requests per event stream under a per-minute quota - expect minutes, and expect
every dimension to print `(empty)` today. That is the measurement.

Custom RPCs: `LATCH_RPC_4663` and `LATCH_RPC_11155111`. The default Robinhood
endpoint (`rpc-robinhood.blockmachine.io`) caps `eth_getLogs` at 10 000 blocks
inclusive and meters requests per minute; `harness/rpc.ts` waits out the quota
response rather than treating it as an empty result. The other public Robinhood
endpoints answer `eth_chainId` but do not serve a real log scan.

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
`sumTokens2({ api, ownerTokens, permitFailure: true, blacklistedTokens })`,
chunked 1000 at a time. Native currency is the zero address in a pool key, and
`sumTokens2` routes `nullAddress` to `eth_getBalance`, so it needs no special case.
Pools with a non-null `hooks` address additionally get their pair summed against
the hook, since Latch hooks can take their own delta - the same treatment
`projects/uniswap-v4` gives them.

### Unpriced tokens: excluded, not zeroed

LTT1 and LTT2 are throwaway tokens the deployer minted to exercise the protocol.
They are the two currencies of the only pool on Robinhood with any history, and the
only tokens the Vault holds. Nothing prices them: `coins.llama.fi` returns no entry
for either, so upstream would already contribute nothing for them.

The adapters do not rely on that. Both tables carry `LATCH_TEST_TOKENS` and both
adapters drop those addresses **before** any balance or volume is booked - the TVL
adapter never asks the Vault about them, and the volume adapter skips a swap whose
pool contains one. Three reasons this is the honest choice rather than letting the
price server decide:

- A token that is merely unpriced can become priced. A dust pool against WETH is
  enough for a DEX-derived feed, and at that moment a test balance would start
  reading as TVL with nobody having decided it should.
- `$0` and "not counted" are different claims. `$0` says "we valued this and it is
  worth nothing"; excluding it says "this has no value by construction and is not
  in the total". The second is the true statement.
- Nothing here assigns a price. No token defaults to `$1`, no stable is assumed, no
  test token is mapped to a real one. Pricing is upstream's job, on real assets.

`test/tvlExclusion.test.ts` pins this offline; `test/robinhood.live.test.ts`
proves it on chain by reading the Vault's LTT balances directly, then showing the
adapter counts none of it - and, with the exclusion lifted for one test, that the
arithmetic would have reproduced the raw amounts to the wei.

### Two RevShareHooks, and why neither is hardcoded

RevShareHook was redeployed on 2026-09-12. The LTT1/LTT2 pool was created against
the **retired** instance and stays there forever: `poolKey.hooks` is part of the
pool id. The TVL adapter takes the hook from each pool's own `Initialize` log, so
that pool's hook balance is in scope without anyone maintaining a hook list, and a
future pool on the current hook is handled the same way. Swap volume and fees do
not see hooks at all - `Swap` is emitted by the pool manager whichever hook the
pool carries - so the split cannot hide volume.

RevShareHook's own take (the revenue share it routes to a pool's beneficiaries) is
**not** tracked here. It is a hook delta, invisible in `Swap.fee`, and it is the
pool owner's revenue under their roster, not the protocol's - unless the treasury
is on that roster, which no pool has done. Tracking it would mean reading each
hook deployment's events, both of them, and attributing per beneficiary. That is a
separate adapter if it is ever worth one; today the amount is dust in test tokens.

### Protocol revenue is read per swap, and has been zero so far

Both Robinhood swaps show `fee = 3000, protocolFee = 0` - the whole 0.30% is the
LP fee, with nothing to compose. The adapter's `dailyRevenue` is the `protocolFee`
each `Swap` carried, so it is a zero read from the log, not a default.

The governance state behind that moved **while this package was being written**.
At 10:50 UTC on 2026-09-12 `protocolFeeController()` read `address(0)` on both
pool managers; at 11:05 UTC it read the `LatchProtocolFeeController`
(`defaultFee = (true, 1000, 1000)`, 0.1% each way) on both. The two swaps predate
the wiring. What it means going forward, from the pool manager's code rather than
from a plan: a pool takes the controller's fee **at `initialize`**, so the existing
LTT1/LTT2 pool keeps `protocolFee = 0` until the controller updates it
specifically, and a new pool will carry 0.1% from its first swap. The adapter
models none of this - it does not read the controller and does not need to,
because whatever rate applied at the moment of a swap is in that swap's log.

`test/robinhood.live.test.ts` therefore checks the wiring for coherence (both
managers agree; a set controller has code and a fee within `MAX_PROTOCOL_FEE`) and
deliberately does not assert its value. Asserting governance state that governance
is entitled to change is how a live test breaks at 11:05 for a reason that has
nothing to do with the adapter.

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
| `dailyRevenue` | `protocolFee` | Gross Profit. Accrues into `protocolFeesAccrued` on the pool manager, collectable only by its `protocolFeeController`. Equals `dailyFees − dailySupplySideRevenue` by construction. Read per swap; zero for every Robinhood swap so far. |
| `dailyProtocolRevenue` | same as `dailyRevenue` | All of it goes to the protocol. |
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

**Verified against the live Robinhood Chain deployment** (`npm test`, 9 live
tests in `test/robinhood.live.test.ts`, all over a fixed historical window):

- all four addresses have bytecode; both pool managers are registered apps;
- the fee-controller wiring is coherent: both pool managers name the same
  controller, it has code, and `defaultFee() = (true, 1000, 1000)` is within
  `MAX_PROTOCOL_FEE` (it was `address(0)` fifteen minutes earlier - see above);
- the pool managers first have code at exactly `fromBlock` (CL 60124455) and
  60124601 (Bin), and not one block earlier;
- decimals are WETH 18, USDG **6**, LTT1 18, LTT2 18;
- exactly one `Initialize`, pool `0xcb1f…50e8`, LTT1/LTT2, `fee = 3000`, bound to
  the retired RevShareHook `0x23CE…E446`;
- both mainnet swaps decode with `fee = 3000, protocolFee = 0`;
- the submitted adapters return **nothing** for that window, and with the
  exclusion lifted reproduce volume and fees to the wei with an empty Revenue;
- the Vault holds LTT1 and LTT2, the pool managers hold none, and the TVL adapter
  counts none of it.

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

- **any USD figure.** The harness has no price feed by design. Everything it
  prints is raw token units. On Robinhood the submitted adapters print nothing at
  all today, because the only tokens involved are excluded.
- **any other mainnet.** The remaining config rows are empty placeholders and have
  never executed.
- **meaningful magnitudes.** On both chains the only activity is one pool, two
  swaps and a couple of liquidity operations from an exercise script. Nothing in
  this package should be read as a production metric, and no sample output here is
  a forecast of one.
- **a non-zero reading from the submitted files.** No Robinhood pool exists yet in
  WETH, USDG or native ETH, so the priced path - `addOneToken` choosing the
  core-asset leg, upstream valuing a Vault balance - has run only on synthetic logs
  in `test/adapter.test.ts` and `test/tvlExclusion.test.ts`.
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

## What blocks listing, and what does not

**Not a blocker - established 2026-09-12:**

- DefiLlama knows the chain. `ROBINHOOD = "robinhood"` in dimension-adapters
  `helpers/chains.ts` (line 398); `"robinhood"` in DefiLlama-Adapters
  `projects/helper/chains.json`; `robinhood` (and alias `robinhoodchain`) with
  seven RPCs and `chainId: 4663` in the published `@defillama/sdk`
  `build/providers.json`; "Robinhood Chain" on `api.llama.fi/v2/chains` with a
  nine-figure TVL from other protocols already indexed there.
- DefiLlama prices the real assets. `coins.llama.fi` returns WETH, USDG and native
  ETH on `robinhood:` with confidence 0.99, and upstream `coreAssets.json` lists
  WETH, USDe and USDG for the chain, so `addOneToken` picks a priced leg.
- The adapters are correct against the chain, to the wei, over a fixed window.

**Blockers, none of them in this repository's control:**

1. **There is nothing priceable to report.** Every reading is zero because the only
   pool is in excluded test tokens. DefiLlama reviewers ask whether a zero day is
   correct; here the honest answer is "yes, and so is the zero week". Whether they
   merge a listing on that basis is their call. A single pool in WETH/USDG or
   ETH/USDG with a real deposit changes it - that is a protocol/liquidity decision,
   not an adapter one.
2. **No public website.** `latch.guru` is NXDOMAIN at the `.guru` registry as of
   2026-09-12 — it does not resolve at all, so this is a registration/DNS gap rather
   than a missing Caddy route. The dexs
   header must not ship a URL that 404s.
3. **Server-side wiring** (`dimensions: { dexs: "latch", fees: "latch" }` in
   defillama-server, plus the protocol entry) is DefiLlama's step after the PRs.
4. **Protocol revenue reads zero for every swap so far, and will for the existing
   pool until the controller updates it.** The controller was wired on 2026-09-12;
   new pools take 0.1% at initialize. Not a blocker to listing, but a reviewer
   will ask why Revenue is empty, and the answer is in
   [Protocol revenue is read per swap](#protocol-revenue-is-read-per-swap-and-has-been-zero-so-far).

## Before submitting

- [x] At least one mainnet row filled in, in **both** config tables (Robinhood).
- [ ] `npm test` and `npm run typecheck` green, **including** the Robinhood live
      tests (not just `LATCH_SKIP_LIVE=1`).
- [ ] Real website URL in the header of `dexs/latch.ts`; the Twitter handle is the
      one the landing page links.
- [ ] Copy only the ★ files; leave every harness stub behind.
- [ ] PR body answers what `AGENTS.md` says every review asks: is a 0-volume day
      correct (yes - see above), why do the numbers differ from Latch's own
      dashboard (the dapp shows LTT1/LTT2 activity in token units; DefiLlama
      excludes it), has the fee split ever changed and when (never; protocol fee
      has been zero on Robinhood since deployment).
- [ ] State in the PR that LTT1/LTT2 are excluded and why, so a reviewer does not
      "fix" it by removing the list.
- [ ] Note in the PR that server-side wiring (`dimensions: { dexs: "latch", fees:
      "latch" }` in defillama-server) is a separate follow-up.
