# LaunchpadKit v2: integration spec

Status: **specification only.** This document changes no code in `LaunchpadKit.sol`,
`LaunchGuardHook` or `RevShareHook`. It specifies how a v2 kit composes three contracts that do
exist:

| Contract | File | Role |
|---|---|---|
| `LaunchTokenFactory` / `LaunchToken` | `src/LaunchTokenFactory.sol`, `src/LaunchToken.sol` | plain fixed-supply ERC-20 at a CREATE2 address nobody can squat |
| `LatchLPLocker` | `src/LatchLPLocker.sol` | permanent custody of CL position NFTs, fee split fixed per lock, pull claims |
| `LatchLaunchRegistry` | `packages/registry/src/LatchLaunchRegistry.sol` | shared launch index, attribution by `msg.sender` |

Numbers come from CLAUDE.md "Kit fees: decided by the owner, 2026-09-13". Where this document
and that section disagree, that section wins.

---

## 1. What "Kit 1" does in one transaction

```
createLaunch(p) payable
  0. checks        launch fee == msg.value, N quotes in 1..maxQuotes, weights sum, split in bounds
  1. token         factory.createToken(name, symbol, uri, supply, address(kit), salt(msg.sender, p.salt))
  2. per quote i   build key_i  ->  record effects  ->  hook.configureLaunch(key_i)
                   ->  clPoolManager.initialize(key_i, sqrtPrice_i)
                   ->  mint single-sided CL range_i with supply_i of the launch token, to the KIT
                   ->  positionManager.safeTransferFrom(kit, locker, tokenId_i, abi.encode(LockParams))
                   ->  launchRegistry.registerLaunch(clPoolManager, poolId_i, token, kit, creator, steward, meta)
  3. remainder     any launch-token balance not seeded goes to p.creatorAllocationRecipient (or reverts, see 2.4)
  4. fees          launch fee to the Safe, integrator launch fee to the integrator
```

No quote currency is pulled. A single-sided range above spot (or below, when the launch token
sorts as `currency1`) holds only the launch token, so a launch quoted in NVDA never touches NVDA
at creation. That matters twice: the launcher needs no stock tokens, and an issuer pause of the
quote cannot block a launch.

### 1.1 Token creation and the salt

```solidity
bytes32 salt = keccak256(abi.encode(msg.sender, p.userSalt));
address token = factory.createToken(p.name, p.symbol, p.metadataURI, p.totalSupply, address(this), salt);
```

The factory folds ITS `msg.sender` (the kit) into the CREATE2 salt. That stops strangers
squatting a deployer's address, but every kit user shares the kit's namespace. **The kit must
fold the launcher into the salt it passes**, or one launcher can take another's mined vanity
address through the kit. `test_squatting_naiveKitSharesOneNamespace` demonstrates the attack on a
kit that forgets.

The SDK predicts the address with
`factory.predictTokenAddress(kit, keccak256(abi.encode(launcher, userSalt)))`, or off chain from
`factory.launchTokenInitCodeHash()`. The hash is constant for a factory build, so the MIT SDK
needs a 32-byte value read on chain and never ships GPL-derived bytecode.

**Known griefing vector, not theft.** The token address is predictable from the pending
transaction, and `LaunchGuardHook.configureLaunch` is first-claim with no code check on the
currencies. A front-runner can claim `poolId_i` before the token exists, making the kit's own
`configureLaunch` revert `NotLaunchOwner`. The whole launch reverts and nothing is lost. Retrying
with a new salt changes the address. Robinhood's sequencer is first-come-first-served with no
public mempool, which makes this hard there and easy on chains with a public mempool. A proper fix
belongs in the hook: let the kit reserve pool ids, or refuse claims on currencies with no code.
Both are hook changes and out of scope here.

### 1.2 Multi-quote launches (N pools, weights)

```solidity
struct QuoteLeg {
    address quote;          // any ERC-20, including Robinhood stock tokens; address(0) = native
    uint16  weightBps;      // share of the seeded supply; legs sum to exactly 10_000
    uint160 sqrtPriceX96;   // opening price, SDK-computed per leg
    int24   tickLower;      // single-sided range, validated below
    int24   tickUpper;
}
```

- `1 <= legs.length <= maxQuotes`. `maxQuotes` is an immutable constructor argument, a gas bound
  sized to the chain's block gas limit. Each leg costs roughly one `initialize`, one CL mint, one
  lock and one registry write.
- `supply_i = seedSupply * weightBps_i / 10_000`, floored, and **the last leg takes the
  remainder**, so the seeded total is exact. Dust is never stranded in the kit.
- Quotes must be pairwise distinct and never the launch token. With a fresh token, `quote != token`
  holds automatically.
- **Single-sidedness is validated, not trusted.** This is the same ordering rule as
  `CreatorReserve`: when the launch token is `currency0`, require `tickLower >= currentTick` after
  `initialize`; when it is `currency1`, require `tickUpper <= currentTick`. Getting that backwards
  does not revert in core. It produces a range made of the quote currency and a mint that pulls
  quote the launcher never sent. Validate the range against the tick core actually reports, not a
  tick computed from the requested price.
- Every leg's position goes through the same `safeTransferFrom` with the same `LockParams`. One
  launch yields N locks, and each lock is separately collectable.

### 1.3 Routing the position into the locker

```solidity
tokenId = positionManager.nextTokenId();
// modifyLiquidities(CL_MINT_POSITION(key, lo, hi, L, max0, max1, owner = address(this), ""), SETTLE_PAIR)
IERC721(address(positionManager)).safeTransferFrom(
    address(this), address(locker), tokenId,
    abi.encode(LockParams({creator: p.creator, creatorBps: c, integrator: p.integrator,
                           integratorBps: i, protocolBps: pr}))
);
```

Rules the kit must follow, each tied to a behaviour of the real contracts:

1. **Mint to the kit, then `safeTransferFrom`.** Never mint with `owner = locker`.
   `CLPositionManager._mint` uses solmate `_mint`, which fires no receiver callback. A position
   minted straight to the locker has no lock record, and nobody can ever attach one.
2. The transfer must happen **after** `modifyLiquidities` returns. `CLPositionManager.transferFrom`
   is `onlyIfVaultUnlocked`, and the Vault is locked during the mint.
3. Liquidity must be non-zero. The locker rejects `EmptyPosition`, because a zero-liquidity
   position can never be poked for fees.
3b. The pool's hook must not register `beforeRemoveLiquidity` or `afterRemoveLiquidity`. The
   locker rejects `HookInterceptsRemoval`, because every fee collection is a zero-liquidity removal.
   Such a hook could revert and block collection forever, or return a delta
   (`afterRemoveLiquidityReturnsDelta`) that takes the fees before the split, bypassing the 20%
   protocol floor. `LaunchGuardHook` (bitmap `0x0041`) passes this check.
4. The kit should assert `locker.isLocked(tokenId)` afterwards and read back
   `getLock(tokenId).protocolBps`. That is cheap, and it turns "the locker accepted what we meant"
   into a checked fact.
5. The kit must also check at construction that `locker.positionManager() == positionManager` and
   `locker.minProtocolBps() >= 2_000`. A kit pointed at a tenant's own locker with a zero floor is a
   full fork and should look like one.

### 1.4 Registry

The kit calls `launchRegistry.registerLaunch(address(clPoolManager), poolId, token, address(this),
creator, steward, metadata)` itself. `msg.sender == launchpad` makes the record
`LaunchpadAttested` and impossible to front-run, because it sits in the transaction that created
the pool. The kit should also implement `ILatchLaunchOrigin.launchOriginOf(poolId)`, returning the
recorded creator, and call `registerLaunchpad(address(this), steward, meta)` once from its own
address so the listing is `SelfRegistered`.

---

## 2. Storage and ABI changes (v1 -> v2)

### 2.1 New immutables (constructor arguments, per the tenant-config rule)

| Name | Type | Notes |
|---|---|---|
| `tokenFactory` | `ILaunchTokenFactory` | shared, one per chain |
| `locker` | `ILatchLPLocker` | Latch-deployed. Constructor checks its position manager and floor |
| `launchRegistry` | `ILatchLaunchRegistry` | may be `address(0)` only if listing is explicitly off |
| `maxQuotes` | `uint8` | gas bound |
| `maxLaunchFeeWei` | `uint256` | immutable cap on the protocol launch fee |
| `launchFeeNoticeSeconds` | `uint32` | ≈ 7 days, measured against `block.timestamp` (see 4) |
| `maxIntegratorLaunchFeeWei` | `uint256` | cap on the tenant's add-on fee |
| `protocolFeeRecipient` | `address` | the governance Safe |

### 2.2 New storage

```solidity
uint256 public launchFeeWei;                  // current protocol launch fee
uint256 public pendingLaunchFeeWei;           // queued increase
uint64  public pendingLaunchFeeEffectiveAt;   // block.timestamp at which it may be applied

struct LaunchRecordV2 {
    address operator;          // as v1
    address launchToken;
    address creator;
    uint64  createdAt;         // block.timestamp
    bool    launchTokenIsCurrency0;
}
mapping(PoolId => LaunchRecordV2) records;        // one per leg; operator etc. shared
mapping(address token => PoolId[]) poolsOfToken;  // bounded by maxQuotes
mapping(PoolId => uint256) lockedTokenId;         // leg -> locker position
```

### 2.3 ABI

```solidity
struct LaunchParamsV2 {
    string  name; string symbol; string metadataURI; bytes32 userSalt;
    uint256 totalSupply;
    uint256 seedSupply;                  // <= totalSupply; the rest goes to creatorAllocationRecipient
    address creatorAllocationRecipient;  // required iff seedSupply < totalSupply
    QuoteLeg[] legs;
    int24   tickSpacing;
    uint32  startDelaySeconds;           // startTime = block.timestamp + this; see 4
    uint32  decaySeconds;                // Preset.Custom only
    Preset  preset;
    address creator;                     // lock creator and registry creator
    uint16  creatorBps; uint16 integratorBps; uint16 protocolBps;  // the locker validates
    address integrator;                  // tenant fee wallet, or 0
    uint256 integratorLaunchFeeWei;      // <= maxIntegratorLaunchFeeWei
    address launchOperator;
    LaunchMetadata listing;              // registry metadata
}

function createLaunch(LaunchParamsV2 calldata p) external payable returns (LaunchResultV2 memory);
function predictLaunchToken(address launcher, bytes32 userSalt) external view returns (address);
function proposeLaunchFee(uint256 newFeeWei) external;   // onlyOwner (Safe)
function applyLaunchFee() external;                      // permissionless once matured
function cancelLaunchFee() external;                     // onlyOwner
function launchOriginOf(bytes32 poolId) external view returns (address);

event LaunchCreatedV2(address indexed token, address indexed creator, address indexed operator,
    uint256 totalSupply, uint256 seedSupply, uint8 legs, uint256 launchFeeWei, address integrator,
    uint256 integratorLaunchFeeWei);
event LaunchLegCreated(address indexed token, PoolId indexed poolId, address indexed quote,
    uint256 lockedTokenId, uint128 liquidity, uint16 weightBps);
event LaunchFeeProposed(uint256 feeWei, uint64 effectiveAt);
event LaunchFeeChanged(uint256 previousWei, uint256 newWei);
```

The schedule fields match the timestamp-based kit: `LaunchResult` reports `startTime` and
`decaySeconds`.

### 2.4 Rules that are easy to get wrong

- **The launch token is fresh, so it can never be fee-on-transfer.** v1's `_pullExact` machinery
  is not needed for the launch side and must not be reused to accept arbitrary launch tokens. v2
  only launches tokens it just created.
- `seedSupply < totalSupply` without a recipient must revert. Leaving tokens in the kit would be
  an unowned balance on a contract with no withdrawal, which is the same class of bug
  `LaunchpadKit`'s header already rules out.
- The kit must hold **zero launch-token balance** at the end of `createLaunch`. Assert it.
- `msg.value` must equal `launchFeeWei + integratorLaunchFeeWei` exactly, plus the native seed
  when a leg is native-quoted. That seed is always zero in a single-sided launch, because native
  only ever sorts to `currency0` and the range holds the launch token. Refuse surplus instead of
  refunding it.

---

## 3. Fee layers

| Layer | Where it is enforced | Latch default | Tenant control |
|---|---|---|---|
| Protocol launch fee | kit v2 `createLaunch` | flat wei, set by the Safe inside `maxLaunchFeeWei` | none |
| Integrator launch fee | kit v2 `createLaunch` | 0 | per launch, `<= maxIntegratorLaunchFeeWei` |
| Locked-LP fee split | `LatchLPLocker` | protocol **>= 20%**, cap 50%; integrator cap 20% | chooses inside the bounds, fixed forever per lock |
| Launch tax | Creator Economy hook (separate contract) | protocol **>= 10% of the tax** | rates, expiry, buckets, integrator share |
| Core swap protocol fee | pool manager via fee controller | **0 on kit-created locked pools** | none |

### 3.1 Protocol launch fee (flat wei)

- `launchFeeWei <= maxLaunchFeeWei`, where the cap is immutable. The owner is the Safe via
  `Ownable2Step`, and `renounceOwnership` reverts. **This gives the kit an owner that v1 never
  had.** The owner's only power is this fee. Add it to CLAUDE.md's ownership table as
  `LaunchpadKit v2 owner -> Safe`.
- **Increase:** `proposeLaunchFee(x)` with `x > launchFeeWei` stores
  `pendingLaunchFeeEffectiveAt = block.timestamp + launchFeeNoticeSeconds`. `applyLaunchFee()` is
  permissionless after that time. A pending proposal is visible on chain and in an event for the
  whole notice window.
- **Decrease:** `proposeLaunchFee(x)` with `x <= launchFeeWei` applies immediately and clears any
  pending increase. Delay never sits on privilege reduction.
- **Never retroactive:** the fee is charged once, at `createLaunch`, at the value in force in that
  block. Nothing about an existing launch reads it again.
- **Avoid the RevShareHook §5 trap.** A matured proposal must not stay armed forever. Give it an
  expiry: it can only be applied within `launchFeeNoticeSeconds` after maturity, and after that it
  must be re-proposed. A UI must also show a pending increase next to the current fee.
- Payment is **pushed** to `protocolFeeRecipient` (the Safe accepts native). The integrator fee is
  pushed to `p.integrator`. Push is acceptable here, and not in the locker, because the
  integrator is chosen by the same caller who pays. A reverting integrator only blocks its own
  launches, never somebody else's.
- A USD-denominated fee needs an oracle and is out of scope. The Safe re-prices wei by hand.

### 3.2 Launch tax (Creator Economy hook)

The "min 10% of tax to protocol" floor belongs in the hook, as an immutable lower bound validated
at configuration, following the same pattern as `LatchLPLocker.minProtocolBps`. The kit only
passes the split through. It must not be the enforcement point: anyone can configure a pool on
the hook without going through the kit.

### 3.3 Core protocol fee = 0 on kit-created locked pools, and what V2 can actually do

This was read from `packages/fees/src/LatchProtocolFeeControllerV2.sol`, which the SDK records as
wired to both managers on Robinhood since 2026-09-13 (`0x9c2c…54aB`).

**What exists:**

1. `setPoolFee(PoolId poolId, bool isSet, uint16 zeroForOne, uint16 oneForZero)`, `onlyOwner`.
   It is a per-pool override with the **highest precedence** in `protocolFeeForPool` (after the
   `feesDisabled` kill switch). Core reads the controller **once, at `initialize`**
   (`ProtocolFees._fetchProtocolFee`). This therefore only affects a pool that does not exist yet.
   Pool ids are deterministic, so the Safe *can* pre-set `(poolId, true, 0, 0)` for a known key.
2. `setPoolProtocolFee(address poolManager, PoolKey key, uint24 newProtocolFee)`, `onlyOwner`.
   It forwards to `ProtocolFees.setProtocolFee`, the only way to reprice a pool that **already
   exists**. Passing `0` zeroes it.
3. `syncPoolToPolicy(poolManager, key)`, `onlyOwner`, pushes whatever `protocolFeeForPool`
   currently resolves.

**What does not exist:** any rule that recognises a kit-created or locked pool automatically.
Every kit pool is dynamic-fee (`LPFeeLibrary.DYNAMIC_FEE_FLAG`), and V2 deliberately defaults
dynamic pools to `DYNAMIC_FEE_PIPS = 999` per direction (`_dynamicFee`, set in the constructor).
**Without action, every kit v2 pool is born paying 999 pips of core protocol fee.** Launches are
permissionless and unscheduled, so a Safe transaction per pool (options 1 or 2) is a manual
process that cannot keep up. Every pool created before its transaction lands pays the fee.

**How to get 0 automatically.** A `LatchProtocolFeeControllerV3` whose hot path adds one rule
ahead of the dynamic default:

```solidity
// inside protocolFeeForPool, after feesDisabled and the per-pool override:
if (address(poolKey.hooks) == address(launchGuardHookV2)) {
    (bool ok, bytes memory ret) = address(kitV2).staticcall{gas: 30_000}(
        abi.encodeCall(IKitV2.isLockedLaunch, (PoolId.unwrap(poolKey.toId())))
    );
    if (ok && ret.length == 32 && abi.decode(ret, (bool))) return 0;
}
```

- This works because `createLaunch` writes the per-leg record **before** `initialize`. v1 already
  orders effects that way, so the record is visible to the controller during the `initialize`
  staticcall.
- `isLockedLaunch(poolId)` must return true only for a leg whose position the same transaction
  will lock. If the lock fails, the transaction reverts and the record goes with it, so the flag
  cannot outlive a failed lock.
- The hot path **must not revert**. The gas-capped `staticcall`, exact-size decode and fallthrough
  to the normal rule are what keep pool creation alive if the kit is ever self-destructed or
  misbehaves. That is the same discipline the V2 header documents.
- Installing V3 is `CLPoolManagerOwner.setProtocolFeeController`, the **Custody (48h)** tier. Pools
  created under V2 in the meantime keep 999 pips until the Safe calls
  `setPoolProtocolFee(manager, key, 0)` on each.
- Key the rule to the kit, not only to `hooks == launchGuardHook`. Anyone can create a pool on that
  hook without locking anything, and the hook check alone would exempt those pools.

---

## 4. Wall-clock requirements

Owner decision (CLAUDE.md §3b): **every duration in Latch contracts uses `block.timestamp`.** On
Arbitrum Nitro chains such as Robinhood (4663), the EVM's `block.number` is Ethereum L1's, so a
block count is not a local clock at all. This spec assumes the timestamp-based `LaunchpadKit` and
`LaunchGuardHook` that are being written now: `startTime` and `decaySeconds`, with no block-time
parameter anywhere.

1. **No block-denominated value in the v2 ABI or storage.** The launch schedule is
   `startTime = uint64(block.timestamp) + p.startDelaySeconds`, computed in the transaction, so a
   transaction that waits in a mempool cannot land with a start already in the past. Custom
   launches pass `decaySeconds`. Presets carry seconds natively, so nothing gets converted.
2. The hook freezes a launch's config at `block.timestamp >= startTime`, and its fee decay is a
   function of `block.timestamp - startTime`. The kit forwards both unchanged.
3. Launch-fee notice (`launchFeeNoticeSeconds`) and proposal expiry are seconds against
   `block.timestamp`.
4. `LatchLPLocker` has no durations. `Lock.lockedAt` is `block.timestamp`. `LaunchTokenFactory`
   has no clock. Neither contract reads `block.number`.
5. Off-chain (keeper, UI, SDK): compare contract timestamps against block header timestamps, never
   against `eth_blockNumber`.

---

## 5. Migration from the deployed kit `0x2a4CA9809C873f9a7eb132cb073710F26D0bBcA7`

- v1 has **no owner, no pause and no upgrade path**. It cannot be retired on chain, and anyone can
  keep calling it. Migration is a change of default in the SDK, the template and the UI. Nothing
  happens on chain to v1.
- Deploy v2 alongside, against the timestamp-based `LaunchGuardHook` redeployment. v1 is bound to
  the deployed hook `0x8b4F…575c`, and `poolKey.hooks` is part of every pool id, so existing v1
  pools stay on that hook forever.
- **Existing v1 positions can be locked voluntarily.** Any holder of a v1 position NFT can call
  `safeTransferFrom(holder, locker, tokenId, abi.encode(LockParams))`. Nothing in the locker is
  kit-specific. The UI can offer "lock this position permanently" for v1 launches, and the fee
  split applies from that moment.
- v1 launches in `LatchLaunchRegistry` stay `Claimed`, because v1 does not implement
  `launchOriginOf`. v2 launches are `LaunchpadAttested`.
- v1 and its hook are block-clocked. On Robinhood every v1 launch window is ~120x its label
  (CLAUDE.md §3b), so the SDK should stop offering v1 for new launches there once v2 is live.
- The fee controller change in 3.3 is a separate Custody-tier migration, and must be live before
  kit v2 opens to the public if the "0 core fee on locked pools" promise is part of launch.

---

## 6. Bin positions: why the locker is CL-only, and the design for a Bin locker

**Decision: `LatchLPLocker` implements CL positions only.** Bin support is a separate contract,
`LatchBinLPLocker`, designed below and not implemented. There are two reasons, both read from this
fork rather than assumed from Liquidity Book.

**Reason 1: Bin shares cannot authenticate a lock.** Bin positions are not ERC-721 or ERC-1155.
`BinFungibleToken` (`packages/periphery/src/pool-bin/BinFungibleToken.sol`) is a bespoke
multi-token with `balanceOf(owner, id)`, `approveForAll` and `batchTransferFrom`, and
`batchTransferFrom` **calls no receiver hook**. There is no `onERC1155Received` to implement. The
CL locker's core safety property ("the only way to create a lock is the transfer itself, so only
the previous owner chooses the split") is unavailable. A Bin locker must instead *pull*:
`lockBin(poolKey, ids, amounts, params)` with `batchTransferFrom(msg.sender, locker, ...)`. That
requires the sender to `approveForAll(locker)` over **all** their bin positions, which is a much
larger standing approval than a single ERC-721 transfer.

**Reason 2: Bin fees cannot be collected without burning liquidity.** In `BinPool.swap`
(`packages/core/src/pool-bin/libraries/BinPool.sol`), LP fees are added to the bin's reserves:
`reserveOfBin[activeId] = binReserves.add(amountsInWithFees).sub(amountsOutOfBin)`. Nothing accrues
per position, and there is no equivalent of the CL zero-liquidity poke. The only way to realise a
bin fee is `BIN_REMOVE_LIQUIDITY`, which **burns shares**. "Liquidity never decreases" stops being
a structural fact about which calls exist and becomes an arithmetic claim about how many shares a
harvest may burn.

**Design for `LatchBinLPLocker` (if the owner wants Bin launches locked):**

- Per `(poolId, binId)`, record `sharesLocked` and `principalLiquidityPerShare`
  (`reserves.getLiquidity(price) * 1e18 / totalSupply` at lock time). At a bin's fixed price, an
  in-bin swap conserves `price * x + y` and adds the fee, so liquidity-per-share is non-decreasing.
  The things that raise it are swap fees, composition fees and donations. Nothing lowers it.
- `harvest(poolId, binIds[])` is permissionless. For each bin it computes
  `burn = shares * (1 - principalLps / currentLps)`, **rounded down**, removes exactly that, and
  credits the proceeds through the same three-way pull split. The invariant becomes: remaining
  shares × current LPS >= locked principal liquidity, per bin. Test it as an invariant with a
  rounding-direction mutation.
- A bin-count cap per lock (for example 64) bounds harvest gas. Bins that price has never crossed
  hold one token and accrue nothing, so skipping them is correct rather than lossy.
- The hazards to spec before building: `MINIMUM_SHARE` behaviour when a bin's supply drops near
  1e3, hooks with `beforeBurn` / `afterBurnReturnsDelta` (they can revert or tax a harvest), and
  the fact that `approveForAll` is all-or-nothing for the locker.

That is a second contract with its own audit surface. Folding it into the CL locker would make the
CL locker's guarantee depend on Bin arithmetic, for no benefit to CL locks.

---

## 7. Shaped Bin curve launches: kit-side validation

A Bin launch seeds one-sided bins of the launch token above (or below) the active bin, in a
chosen shape, through `BinPositionManager`'s
`BinAddLiquidityParams { deltaIds[], distributionX[], distributionY[], ... }`. Distributions are
1e18-precision fractions of `amount0`/`amount1` (`LiquidityConfigurations.PRECISION`). The kit
builds these arrays from a preset or validates a custom shape before calling:

1. **Single-sided.** For a launch token that is `currency0`, every `deltaId > 0` (strictly above
   active) and every `distributionY == 0`. Mirror the rule for `currency1`. The same ordering bug
   described in 1.2 applies.
2. **Monotonic prices.** `deltaIds` strictly increasing (strictly decreasing for `currency1`). Bin
   price is a pure function of id and `binStep`, so this is the price-monotonicity check.
3. **No gaps below the floor.** `deltaIds[k+1] == deltaIds[k] + 1` from the first bin up to
   `floorBins`. A gap near the opening price is a region with no liquidity where one trade moves
   price across the hole. Gaps above the floor (a stepped shape) are allowed and must be declared.
4. **Bin-count gas cap.** `deltaIds.length <= maxBins`, an immutable constructor argument sized to
   the chain's gas limit. Each bin is an SSTORE-heavy mint, and the same count bounds the future
   `LatchBinLPLocker.harvest`.
5. **Totals.** `sum(distributionX) == 1e18` exactly, not `<=`. Otherwise the unallocated fraction
   silently stays with the kit. The minted launch-token amount must equal `seedSupply`, measured
   by the kit's balance delta across the call. The kit must end with zero launch-token balance.
6. **Per-bin sanity.** Every `distributionX[k] > 0`, because a zero-weight bin is a gap that looks
   filled, and `minLiquidities[k] > 0`.

**Named presets** (the kit computes the arrays; users choose a name and `binCount`):

| Preset | Shape of `distributionX[k]` | Use |
|---|---|---|
| `Flat` | `1e18 / n` each, remainder to the last bin | even sell wall; closest to a fixed-price sale |
| `Linear` | proportional to `n - k` | more depth near open, thinning upward |
| `Exponential` | proportional to `r^k`, `r < 1` fixed per preset (for example 0.9) | deep open, long thin tail; price discovery |
| `Stepped` | `m` equal tiers of contiguous bins, tier weights decreasing, fixed gaps between tiers | "rounds"; the gaps are the declared exception to rule 3 |
| `Custom` | caller arrays, rules 1-6 enforced | anything else |

Rounding in every preset: compute each weight floored, then give the last bin
`1e18 - sum(previous)`, so rule 5 holds exactly.

---

## 8. Locker design decisions, recorded

| Decision | Chosen | Trade-off |
|---|---|---|
| Hook filter | refuse pools whose hook registers a remove-liquidity callback | Stops a hook from bricking or skimming collection. It does NOT stop a tenant hook that keeps the LP fee near zero and charges a hook fee instead: the locker's floor applies to LP fees only, so kit v2 must launch only on Latch hooks. |
| Lock entry | `safeTransferFrom` + `onERC721Received` only | Authenticated by the transfer. A plain `transferFrom` or a direct mint to the locker is unrecoverable. That is documented, and it is the price of having no "attach" function a stranger could call. |
| Split | per lock `creatorBps / integratorBps / protocolBps`, sum 10 000, fixed forever; immutable `minProtocolBps` 2000, `maxProtocolBps` 5000, `maxIntegratorBps` 2000 | The floor is Latch's enforced revenue on Latch's locker. A tenant deploying their own locker can set anything. That is the full-fork path, and it is allowed. |
| Rounding dust | creator and integrator floored, **protocol gets the remainder** | Deterministic. The protocol never gets less than its bps. At most 2 base units extra per currency per collect. |
| Integrator | per lock address + bps, not an immutable locker slot | One shared locker serves every tenant. An immutable slot would force one locker per tenant and fragment the "one verified contract" moat. |
| Integrator rotation | none | Point it at a Safe, whose signers rotate without the address changing. Per-lock rotation for a tenant with thousands of locks would be thousands of transactions. |
| Creator rotation | 2-step (`transferCreator` / `acceptCreator`), no delay; credited balances stay with the old address | Lets a launcher move a hot key to a Safe, or sell the fee right. A delay would add nothing: whoever holds the key can already claim every future credit. |
| `protocolRecipient` | immutable | A setter needs an owner key able to redirect the protocol share of every lock at once. The Safe's address is stable across signer rotation. Cost: if the Safe itself is lost or compromised, protocol share on existing locks is lost with it, and only new locks on a new locker escape. |
| Payments | pull, per party, per currency, `claim(currency, to)` | A paused or blocklisting token blocks only its own claims. `to` lets a blocklisted party redirect. |
| Crediting | measured balance delta around the position-manager call | Correct for fee-on-transfer. Positive rebases and donations become surplus, which `skim` sends to protocol. |
| Stray native | `receive` only from the Vault | Only forced native (a self-destruct) can arrive uninvited, and `skim` handles it. |
| Token deploys | full CREATE2 deploy with a parameter callback, not EIP-1167 clones | +~0.7M gas once per token. In exchange: no DELEGATECALL on every transfer for the token's life, no initializer, a constant init-code hash (so vanity salts are reusable and the MIT SDK ships no bytecode), and identical bytecode for verification. |

---

## 9. Open questions for the owner

1. **Kit v2 gains an owner** (the Safe) for the launch fee. v1 had none by design. Confirm this,
   and add the row to the ownership table.
2. **Fee controller V3** (3.3) is the only way to make "0 core fee on locked pools" automatic, and
   installing it is a 48h Custody operation. Until then, is a manual `setPoolProtocolFee` per pool
   acceptable, or should kit v2 wait for V3?
3. **Bin launches**: build `LatchBinLPLocker` (section 6), or ship Bin shapes unlocked at first?
4. **Pool-id squatting on predictable token addresses** (1.1) needs a hook-side fix. Should the
   `LaunchGuardHook` rewrite reserve pool ids for a registered kit?
5. **`skim` beneficiary** is the protocol. The alternative is to leave surplus stranded. Confirm.

---

## 10. Bin locker (implemented)

Status: **implemented** as `src/LatchBinLPLocker.sol` + `src/interfaces/ILatchBinLPLocker.sol`, with
`script/DeployLatchBinLPLocker.s.sol`. Section 6 above is the problem statement; this section is the
design that was built, and where it refines section 6 (per-lock rather than per-bin records, pull
entry authenticated by `msg.sender`), this section wins. Every claim below was read from this fork's
`BinPool.sol`, `BinHelper.sol`, `BinPositionManager.sol` and `BinFungibleToken.sol`.

### 10.1 The guarantee, stated as the CL locker states it

| | `LatchLPLocker` (CL) | `LatchBinLPLocker` (Bin) |
|---|---|---|
| Principal | position liquidity `L`, never decreases | per bin: the lock's shares are always worth at least the bin-liquidity they were worth at lock time |
| Fee collection | zero-liquidity decrease; structurally cannot touch `L` | burns only the share count whose value EXCEEDS that principal; arithmetic, rounded against the burn |
| Split | per lock, fixed, floor 2000 / cap 5000 / integrator cap 2000, dust to protocol | identical, same `LockParams`, same `splitAmount` |
| Payouts | pull, per party, per currency | identical |
| Entry | `safeTransferFrom` + `onERC721Received` | `lock(key, binIds, shares, params)` pulls from `msg.sender` |
| Admin | none | none |

### 10.2 What "principal" and "fee" mean for a bin

A Bin pool bin has one fixed price `P` (Q128, a pure function of `binId` and `binStep`). Core measures
a bin's value as `L = P·x + y·2^128` (`BinHelper.getLiquidity`). Three facts from the fork make `L`
the right unit:

1. **An in-bin swap conserves `L` exactly, before fees.** `getAmountsOut` / `getAmountsIn` price every
   unit at `P` and round in the bin's favour (input rounded up, output rounded down), so a swap adds
   `ΔL >= 0` plus its LP fee. The protocol's cut `pFee <= totalFee` is removed before it reaches the
   reserves (`BinPool.swap`, `getProtocolFeeAmt`), so the LP fee part can only raise `L`.
2. **Nothing crosses bins.** A swap that exhausts a bin moves to the next one; no operation moves
   value from one bin's reserves to another's. Per-bin accounting is therefore exact, not an
   approximation. (This is the property CL does not have, and why CL needs fee-growth accounting.)
3. **`L / totalShares` is non-decreasing under every core operation.** Swaps (fact 1), third-party
   mints (`shares = floor(userL·S/binL)`, surplus input trimmed only down to the effective liquidity),
   third-party burns (`amountOut = floor(burn·reserve/S)`), composition fees (credited to existing
   shares before the minter's shares are computed) and `donate` all leave `L/S` equal or higher.

So for a single-sided launch position, **selling launch tokens to buyers does not change `L`**: a bin
that was 100% launch token and is now 100% quote token holds the same `L`, plus fees. The quote
tokens received for sold launch tokens ARE the principal, in a different currency, and stay locked
as the pool's buy-back depth. That is exactly what the CL locker already does with a single-sided
CL range that is bought through, so it is the owner's approved model rather than a new decision:
**sale proceeds are principal and are never withdrawn by anyone; the protocol floor applies to fees
only.**

Definitions, per lock `k` and bin `b`:

```
shares[k][b]     locked share count, written at lock, decreased only by collectFees
principal[k][b]  = ceil(sharesAtLock · L_b / S_b)       bin-liquidity units, written once
value[k][b]      = shares[k][b] · L_b / S_b              at any moment

INVARIANT  value[k][b] >= principal[k][b]                for every lock, bin and block
fee        = value - principal                            (swap fees, composition fees, donations,
                                                            and third-party rounding dust)
```

`collectFees` burns, per bin, `burn = shares - ceil(principal · S / L)`, so the shares that remain
satisfy `remaining · L / S >= principal` before the burn; and because core pays the burn out floored,
the burn itself raises `L/S` for the shares that remain. The two rounding directions both point at
the principal. Mutating either one fails `testFuzz_harvestableShares_neverCrossesPrincipal`
(`test/LatchBinLPLocker.fuzz.t.sol`).

**What this does NOT mean, stated plainly.**

- **Fees are delivered in the bin's CURRENT composition, valued at the bin's price.** Bin fees are not
  tracked per token by core; they are part of `L`. A fee paid in quote by a buyer, harvested after
  sellers have swapped the bin back to launch token, is delivered as launch token worth the same `L`
  at `P`. If the market has since fallen below `P`, that launch token is worth less than the fee was
  when it was paid. Uncollected fees therefore carry the position's price exposure until someone
  calls `collectFees`. Mitigation: harvest often (it is permissionless, and the keeper can do it).
  Not an extraction path: a caller who swaps a bin's composition to change what the parties receive
  pays swap fees that are themselves harvested, and moves no value to himself.
- **Fees accrued BEFORE the lock are principal.** The share price at lock time is the baseline. A kit
  locks in the same transaction as the mint, so this is zero for kit launches. A holder who locks an
  old position voluntarily forfeits its uncollected fees into the permanent principal. The CL locker
  differs (it collects pre-lock fees), because CL tracks fees separately and Bin cannot.
- **Principal in TOKEN terms moves with price**, as for any LP position. The guarantee is in bin
  liquidity at each bin's own price, which is the same unit core uses for everything.

### 10.3 Options evaluated

**(a) Track principal per bin, burn only the excess — CHOSEN, refined as above.** Measured in `L`
rather than in reserve amounts, which is what makes it correct under price movement. Cost: the
no-withdraw property is an arithmetic claim about one function instead of a structural absence of
calls, so it is guarded by an invariant suite, a per-bin fuzz and mutation checks rather than by
reading the call list alone.

**(b) Lock shares forever and route revenue through the pool's hook fee (RevShareHook).** Rejected.
It does make the no-withdraw property structural (the locker would never call the position manager
again), but it fails the brief in three ways: the locked-LP revenue line in "Kit fees" becomes zero
(LP fees compound into the bins forever and nobody receives them); the hook fee is configured by the
pool owner through `proposeConfig` / `reduceFee` / `disable`, so the split is neither per-lock nor
immutable; and it forces every Bin launch onto one hook. A hook fee is a legitimate SECOND layer (the
"launch tax" row), not a replacement for this one.

**(c) Alternatives found in the fork, rejected:**

- *Reserve snapshots* (`x0, y0` at lock, harvest what exceeds them): wrong by construction. A bought
  bin has `x < x0`, so it reads as a loss while it is a sale at `P`; a harvest keyed to `y > y0` would
  pay sale proceeds out as fees and put the protocol floor on them.
- *Locker mints directly on core with a per-lock salt* (`BinPoolManager.mint` keys positions by
  `(owner, binId, salt)`): isolates each lock's shares natively and makes orphans impossible, but
  turns the locker into a Vault-locking liquidity app that must settle tokens and re-implement the
  position manager's slippage checks. Much larger surface, and it does not change the fee problem.
- *One lock per bin, shares read from `balanceOf`*: avoids per-lock share storage, but any stray
  transfer to the locker would silently become harvestable "fee", and two locks in the same bin
  (a kit lock plus a later voluntary lock) would be impossible.

### 10.4 Entry without a receiver callback

`BinFungibleToken.batchTransferFrom` calls no hook, so the lock pulls:

```solidity
function lock(PoolKey calldata key, uint24[] calldata binIds, uint256[] calldata shares, LockParams calldata p)
    external returns (uint256 lockId);
// inside: positionManager.batchTransferFrom(msg.sender, address(this), tokenIds, shares)
```

- **Authentication** is `msg.sender`: the account whose shares move is the only one who can choose
  the split, which is the property `onERC721Received` gave the CL locker. The pull source is hard-coded
  to `msg.sender`; there is no `from` parameter.
- **The standing approval is bounded by that.** `approveForAll(locker, true)` is all-or-nothing over
  the approver's bin shares, but the locker can only ever exercise it inside a `lock` call the
  approver makes itself. A third party cannot pull anyone's shares through the locker.
- **Receipt is measured**: `balanceOfBatch` before and after, and every bin must arrive exactly.
- **Orphans.** Shares sent to the locker with a plain `batchTransferFrom` have no lock record and are
  stranded forever: no function burns, moves or attributes them, and a harvest never touches more
  than a lock's own recorded shares. They stay in the pool as permanent liquidity. An "attach" or
  "skim shares" function was rejected: attach is front-runnable (first caller names the creator),
  and a share-skim would add a second burn path whose correctness depends on summing every lock.
- **Same-transaction atomicity for the kit**: mint to the kit, then `lock` after `modifyLiquidities`
  returns (`batchTransferFrom` is `onlyIfVaultUnlocked`), all inside `createLaunch`.

### 10.5 Hazards addressed

| Hazard | Handling |
|---|---|
| Hook runs on burn (`beforeBurn`, `afterBurn`, `afterBurnReturnsDelta`) | refused at lock (`HookInterceptsRemoval`): every harvest is a burn, and such a hook could block it or take the proceeds before the split |
| `BinPool__ZeroAmountsOut` / `BurnZeroAmount` would revert a whole multi-bin harvest | bins whose burn floors to zero out are skipped; if every bin is skipped, `NothingToCollect` (a free read for keepers) |
| `MINIMUM_SHARE` / bin removed from the tree | a harvest always leaves `ceil(principal·S/L) >= 1` shares, so it never empties a bin it holds |
| Gas | `maxBinsPerLock` immutable constructor argument, bounds both `lock` and `collectFees` |
| Pool manager paused | `BinPoolManager.burn` is not `whenNotPaused`, so collection still works |
| Paused / blocklisting quote token | the whole harvest reverts, fees stay in the bins and keep compounding, retry after unpause; credited balances wait in `claimable` |
| Fee-on-transfer quote | credit is the measured balance delta |
| Reentrancy | `nonReentrant` on every mutating entrypoint; shares are decremented before the position-manager call |
| Duplicate bin ids in one lock | refused: ids must be strictly increasing |
| LP fee kept near zero by a tenant hook | NOT handled, as for CL (section 8): the floor applies to LP fees |

### 10.6 What kit v2 calls, in order, for one Bin leg

```
constructor (once)   require(binLocker.positionManager() == binPositionManager)
                     require(binLocker.minProtocolBps() >= 2_000)
                     require(maxBins <= binLocker.maxBinsPerLock())
                     binPositionManager.approveForAll(address(binLocker), true)
createLaunch, per Bin leg:
  1. record leg effects (so the fee controller V3 can see isLockedLaunch during initialize)
  2. hook.configureLaunch(key)                               // if the hook needs it
  3. binPoolManager.initialize(key, activeId)
  4. read activeId back; validate shape rules 1-6 of section 7 against it
  5. binPositionManager.modifyLiquidities(
         BIN_ADD_LIQUIDITY(key, amount0, amount1, max0, max1, activeId, idSlippage 0,
                           deltaIds, distX, distY, minLiquidities, to = address(kit), ""),
         SETTLE_PAIR(currency0, currency1))
  6. for each bin: shares[i] = binPositionManager.balanceOf(kit, toTokenId(poolId, binIds[i]))
                   (fresh pool: the whole balance is this mint)
  7. lockId = binLocker.lock(key, binIds (strictly increasing), shares, LockParams)
  8. assert binPositionManager.balanceOf(kit, tokenId_i) == 0 for every bin
     assert binLocker.getLock(lockId).protocolBps == intended; isLocked(lockId)
  9. launchRegistry.registerLaunch(address(binPoolManager), poolId, token, kit, creator, steward, meta)
```

Never mint with `to = binLocker`: those shares arrive without a record and are orphans (10.4).
