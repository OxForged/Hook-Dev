# Latch Launch — design, for approval before implementation

Status: **proposal**. Nothing here is built. Per §36 of the brief, this document exists to be
argued with first.

Written against **option (a), the single-sided range order**. The brief's own mechanism —
sell a tranche of creator tokens every 15 buys — is analysed in §G and recommended against.
If you want that version anyway, §G says what it would take to make it survivable.

---

## A. Architecture

Four contracts, two of which already exist and are live.

```
LaunchpadKit            EXISTS. Creates the pool, seeds it, one call.
LaunchGuardHook         EXISTS. Fee decay, start block, per-tx buy cap.
  ↑ both extended, not replaced

CreatorReserve          NEW. Owns the CMR position NFT. Accounting + withdrawal.
LaunchRegistryView      NEW, optional. Read-only aggregation for the UI.
```

The brief proposes `LatchFactory`, `LatchLaunch`, `LatchLaunchHook`, `CreatorReserve` and
`CreatorTreasury` — five new contracts. I recommend two, because `LaunchpadKit` already is
the factory (`createLaunch` validates config, initialises the pool, seeds liquidity, and
optionally lists the hook) and `LaunchGuardHook` already is the launch hook. Adding a
parallel factory beside a working one gives two code paths for pool creation, two places a
launch can be recorded, and the near-certainty that one of them drifts.

**`CreatorTreasury` is deliberately not a contract.** The creator names a payout address;
`CreatorReserve` pays it. A separate treasury contract adds an upgrade surface, a second
ownership question, and a place for funds to get stuck, in exchange for nothing the payout
address does not already provide. If the creator wants a Safe, they name a Safe.

### What stays untouched (brief §I)

`packages/core` in its entirety. No change to `Vault`, `CLPoolManager`, `BinPoolManager`,
`CLPool`, `Hooks`, `CLHooks`, or any type. The launch system is a hook plus a periphery
contract; it needs no core change, and a core change would fork us off upstream for a
feature that does not require it.

### What changes (brief §H)

| Contract | Change |
|---|---|
| `LaunchpadKit` | `LaunchParams` gains a CMR block. `createLaunch` mints a second, single-sided position and hands it to `CreatorReserve`. |
| `LaunchGuardHook` | Counts qualifying buys and emits milestone events. **No settlement logic.** |
| `CreatorReserve` | New. Holds the CMR position, collects fees from it, converts, pays out. |

---

## B. Token flow

At launch, the creator supplies the whole token supply they intend to distribute, split by
the configured ratio. With the 75/25 default and a native quote:

```
creator supplies:  S tokens  +  Q native

  75% of S  ─┬─► two-sided position, full or wide range, around the opening price
      Q     ─┘   → this is the tradable book. Ordinary V3 liquidity.

  25% of S  ───► SINGLE-SIDED position, ticks [P_start, P_ceiling], token-only
                 → the Creator Marketing Reserve. Held by CreatorReserve.
```

A single-sided position above spot holds only the base token. It is, exactly, a ladder of
limit sell orders spread across the range. Nothing about it is novel — it is what a V3
position above the current price *is*.

As price rises through the range, the AMM fills those orders: token leaves the position,
native enters it. The reserve converts continuously, in proportion to how far price has
travelled, with no transaction from anyone.

```
price below P_start   → CMR is 100% token.        Creator has received nothing.
price mid-range       → CMR is part token, part native. Partially realised.
price above P_ceiling → CMR is 100% native.       Fully realised.
price falls back      → the AMM buys the token BACK with the native.
```

That last line is the honest one and it must be in the UI: **an unrealised reserve can
un-realise.** Range orders are not one-way.

---

## C. Native asset flow

`Currency.wrap(address(0))` is the native asset in Infinity, and the Vault handles it
natively — there is no WETH round trip inside the pool. The path out is:

```
CLPositionManager.modifyLiquidities  (DECREASE_LIQUIDITY / TAKE_PAIR)
        │  called by CreatorReserve, which owns the position NFT
        ▼
     Vault ──native──► CreatorReserve
        │
        ▼  PULL, not push
   creator calls withdraw() → native to the payout address
```

**Pull, not push, and the brief asks for a recommendation here (§9): pull.** A push pays an
arbitrary address inside a state-changing call. If the payout address is a contract that
reverts, or consumes more than the stipend, or reenters, the failure lands on whoever
triggered the settlement — potentially an unrelated trader. Pull confines every failure to
the creator's own transaction. `withdraw()` is `nonReentrant`, uses a bare `call` with full
gas (not `transfer`, whose 2300-gas stipend breaks Safes), and follows
checks-effects-interactions with the balance zeroed before the call.

For an **ERC-20 quote token** rather than native, the reserve accrues that token and the
creator withdraws it as-is. The brief asks for automatic conversion to native. I recommend
against it: converting requires routing through some pool at some price at some moment, and
that decision belongs to the creator, not to a contract that must never revert. Launching
against the native asset — which is the default anyway — makes the question disappear.

---

## D. 75/25 accounting

The brief asks (§34) where the 25% *actually resides*. Under this design the answer is
precise and checkable: **inside the AMM, as a position NFT owned by `CreatorReserve`, whose
token id is emitted at launch and readable forever.**

```
totalReserve      = tokens contributed to the CMR position at launch   (immutable)
remainingToken    = token side of the position now                     (read from the pool)
realisedNative    = native side of the position now + already withdrawn
withdrawn         = native paid out to the creator                     (monotonic)
```

`remainingToken` and the native side are **read from the position**, not tracked in
storage. That kills a whole class of bug: there is no counter to drift, no
`releasedReserve > totalReserve` to guard against, no `remainingReserve < 0` to make
impossible, because neither is a stored number. The invariant the brief asks for is
enforced by construction rather than by a `require`.

The one stored number is `withdrawn`, and it is monotonic.

### How the reserve interacts with price

It is liquidity, so it *supports* price on the way up by absorbing buys — the same as any
other sell-side liquidity. It does not "dump". The token was always going to reach the
market; this design fixes **in advance, publicly, at launch** the exact prices at which it
does, and puts that on the launch page before anyone buys.

Compare the brief's mechanism, where the same tokens hit the market at whatever price
prevails when the 15th buy lands.

### Exhaustion, low volume, no buys

- **Exhausted** (price above `P_ceiling`): CMR is entirely native. The creator withdraws and
  the position is empty. No further creator claim on anything. Clean terminal state.
- **Low volume**: partial realisation, proportional. Nothing special happens and nothing
  needs to.
- **No qualifying buys at all**: the creator receives **nothing**. This is the correct
  outcome and it is the one the brief's model cannot produce — a milestone counter can be
  self-triggered, a price cannot be self-sustained.
- **Insufficient liquidity for settlement**: cannot occur. There is no settlement
  transaction that could fail.

---

## E. The 15-buy epoch

**Keep it. Decouple it from money.**

Under this design the milestone counter drives the launch page, the progress bar, the epoch
history and the analytics — everything in brief §13/§14 — and drives **no market
operation**. That separation is the whole point, and it is what makes the counter safe to
compute cheaply and safe to leave permissionless.

```
epoch  = buyCount / buyMilestone
in-epoch progress = buyCount % buyMilestone
```

Two `uint32`s in one slot on the hook, incremented in `afterSwap` when
`isQualifyingBuy()` holds. One `SSTORE` to a warm slot on qualifying buys, nothing
otherwise.

### `isQualifyingBuy()`

```
zeroForOne matches "quote → launch token" for this pool's ordering   (direction)
AND  |amountSpecified| >= minimumBuyValue in QUOTE units             (size)
AND  sender is not the CreatorReserve                                (no self-count)
```

Liquidity operations never reach `afterSwap`, so they are excluded structurally rather than
by a check. Zero-value swaps fail the size test.

### The Sybil analysis the brief asks for (§5) — and the honest conclusion

**A buy counter cannot be made trustworthy, and this repo already knows it.**
`LaunchpadKit.sol:82` — *"There is no per-wallet cap here because none is implementable."*
`LaunchPresets.sol:95` — *"DOES NOT PROTECT AGAINST: sybil splitting across wallets or
transactions."*

| Mechanism | What it costs an attacker | Verdict |
|---|---|---|
| minimum trade size | `15 × min`, most of it recovered on sale | raises cost, changes nothing structurally |
| unique-wallet counting | one `CREATE2` per wallet | free to defeat |
| cooldowns | latency only | slows, never stops |
| per-wallet limits | not implementable — the hook sees a router, not a person | **does not work** |
| oracle USD minimum | an oracle dependency in the swap path | cost without a change in kind |

So: **a creator can always self-trigger their own milestones.** Under the brief's design
that means a creator can trigger their own settlements, which is a governance problem. Under
this design it means a creator can inflate a progress bar, which is a *cosmetic* problem —
and the UI can simply show unique buyer count beside it and let readers draw conclusions.

This is the strongest single argument for decoupling. **It converts an unfixable security
problem into a cosmetic one.**

---

## F. Infinity hook execution flow

Grounded in the fork, not assumed (brief §28). Verified in
`packages/core/src/pool-cl/libraries/CLHooks.sol` and `src/libraries/Hooks.sol`:

```
CLPoolManager.swap(key, params, hookData)
  └─ CLHooks.beforeSwap        if key.parameters bit HOOKS_BEFORE_SWAP_OFFSET
       └─ LaunchGuardHook: enforce startBlock, maxBuyPerTx, return the decayed fee
  └─ CLPool.swap                                        ← price moves through the CMR range
  └─ CLHooks.afterSwap         if bit HOOKS_AFTER_SWAP_OFFSET
       └─ LaunchGuardHook: isQualifyingBuy? ++buyCount; emit; maybe emit EpochCompleted
```

Three facts that constrain the design, each verified:

1. **Permissions live in `poolKey.parameters`, not the hook address.** Core cross-checks
   `parameters` against `getHooksRegistrationBitmap()` exactly once, at `initialize`
   (`Hooks.sol:58`), and dispatches off `parameters` forever after. No CREATE2 salt mining.
2. **`afterSwap`'s unspecified delta has no core bound.** The
   `HookDeltaExceedsSwapAmount` check exists only in `beforeSwap`, on the specified delta
   (`CLHooks.sol:158`). A hook's own cap is the only limit. **This design takes no
   `hookDelta` at all**, which removes the entire question.
3. **The counter must not be able to revert a swap.** `afterSwap` runs inside the trade. An
   overflow, a division, or an external call there is a way to brick the pool. Two
   `uint32`s and an event cannot.

---

## G. Security risks

### G1 — The brief's own mechanism is front-runnable by construction. CRITICAL if built.

`buyCount` is public state and settlement fires deterministically at 15. A bot reads
`buyCount == 14`, front-runs the 15th buy, lets the settlement sell land, and buys back
lower. The loss is split between the creator's execution price and the honest buyers' fills.

This is not a mitigable detail — the trigger *is* the signal. If you want (b) anyway, the
minimum viable mitigations are: settle a proportional slice on **every** qualifying buy
rather than 15× at once (removes the discontinuity), or add a commit-reveal delay of
unpredictable length (adds an oracle or a VRF), or route settlement through a private
mempool (adds a trusted relay). All three cost more than option (a) and none is as good.

### G2 — Range-order risk, which is real and must be disclosed

Price can pass through the range and come back, converting native back into token. The
creator's realised amount is not monotonic until withdrawn. **The launch page must say
this**, and the creator dashboard must distinguish *realised and withdrawn* from *realised
and still in the position*.

### G3 — Launch squatting (already found, already live)

`createLaunch` is first-come for a `(launchToken, quoteToken, tickSpacing)` triple, and a
zero-seed launch is permitted. An attacker front-runs a launch with a hostile opening price
and the real launcher is locked out of that key. Mitigation is procedural: launch from a
private mempool, or bundle `createLaunch` into the token deployment. Worth stating in
`LaunchpadKit`'s "what it does not do" block.

### G4 — Reserve ownership

`CreatorReserve` holds an NFT that is worth real money. `withdraw()` must be
`nonReentrant`, CEI-ordered, and payable only to the recorded payout address.

**Recommendation on the brief's question — should the creator wallet be immutable?**
Two-step, not immutable and not free. Immutable means a compromised or lost creator key
strands the reserve forever. Freely mutable means a compromised key redirects it instantly.
`Ownable2Step`-style nomination plus acceptance, with a **72-hour delay and a public
event**, gives a legitimate creator a path to rotate and gives everyone else 72 hours to
notice a hostile one.

### G5 — What is deliberately absent

No admin key over a live launch. No pause on the reserve. No function that moves the
position NFT. Nobody — creator, protocol, governance — can change the CMR range after
launch, because the range is the disclosure.

---

## H / I. Contracts to modify, and to leave alone

**Modify:** `packages/launchpad/src/LaunchpadKit.sol`,
`packages/launchpad/src/LaunchGuardHook.sol`, `packages/launchpad/src/interfaces/*`.
**Add:** `packages/launchpad/src/CreatorReserve.sol`.
**Do not touch:** all of `packages/core`, `packages/periphery`, `packages/router`,
`packages/hooks-revshare`, `packages/registry`, `packages/governance`.

---

## J. Implementation plan

Each step ends somewhere shippable.

1. **`CreatorReserve`** — hold a position, read its two sides, collect, pull-withdraw,
   two-step payout rotation. Full test suite including the price-comes-back case.
2. **`LaunchpadKit` CMR block** — `LaunchParams` gains `cmrBps`, `cmrLowerTick`,
   `cmrUpperTick`, `creatorPayout`. Mint the second position, transfer to the reserve.
   Configurable ratio, 75/25 as a preset, per brief §2 and §27.
3. **`LaunchGuardHook` counter** — `isQualifyingBuy`, `buyCount`, `epoch`, events. Gas
   measured before and after; the swap path must not regress meaningfully.
4. **Events and SDK** — the full event set from brief §10, then `getLaunch`,
   `getCreatorReserve`, `getMilestone` in `packages/sdk`.
5. **UI** — launch wizard, launch page, creator dashboard. Reading chain directly, as the
   rest of the dapp does.
6. **Indexer and API** — *only if* the direct-read UI proves too slow. It has not yet, and
   `CLAUDE.md`'s "no invented data" rule is much easier to hold when the UI reads chain.

### On the backend tier in brief §16–§20

I recommend deferring all of it. There is no backend today and the dapp reads chain
directly, which is precisely why it can honestly claim every number on screen. A Postgres
tier becomes the thing users see, and "the blockchain is authoritative" turns from an
architectural fact into a policy someone has to enforce on every endpoint. Add it when a
measured page-load problem demands it, and add it as a cache with the chain still
authoritative on read.

---

## The one-sentence disclosure

Everything above has to survive being compressed to something a buyer reads in four seconds:

> **25% of the supply is held as sell orders between $X and $Y. The creator is paid only as
> those orders fill, and only if the price gets there.**

That sentence is true, complete, and impossible to write about the 15-buy design.
