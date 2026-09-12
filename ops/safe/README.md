# Safe batches

Import these into the Safe **Transaction Builder** — one signed transaction per
file, rather than one per call. Batching matters here beyond convenience: the
three accepts either all land or none do, so there is no half-migrated state
where the Vault answers to the Safe and the fee controllers still do not.

Safe (2 of 3), Robinhood Chain 4663:

    https://app.safe.global/home?safe=robinhood:0x715a6176946aDbD22c1B2021d321Fb3767ca3432

## robinhood-accept-ownership.json

Three `acceptOwnership()` calls — Vault, CLProtocolFeeController,
BinProtocolFeeController.

**Why this exists.** Every ownable in this protocol is `Ownable2Step`, so the
deploy script's `transferOwnership` only NOMINATES. Until the nominee accepts,
the deployer EOA is still the owner — and on the Vault that means one hot key
can call `registerApp`, which is irreversible. This batch is what actually
transfers control.

Simulated from the Safe before publishing: all three succeed, and
`pendingOwner()` is the Safe on all three.

### Steps

1. Open the Safe URL above → **Apps** → **Transaction Builder**
2. Drag the JSON in (or "Load from file")
3. Confirm it shows **3 transactions**, all with data `0x79ba5097` and value 0
4. Create → sign with two of the three owners → execute

### Afterwards

Check it landed, rather than trusting the UI:

    cast call 0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c "owner()(address)" \
      --rpc-url https://rpc.mainnet.chain.robinhood.com

Expect `0x715a6176946aDbD22c1B2021d321Fb3767ca3432`. Do the same for
`0xb1cC5BDBADD19a2430131EaE332afD72fF6be64B` and
`0x320feB54e940741AeB037E3944F2C95afAEE84af`.

### This is not the destination

> **SUPERSEDED 2026-09-12.** Both timelocks named below are RETIRED. The custody
> destination is now `0x3aE354e2cdFB9Cb855ABA41c825F6Ee53f28e119` and the Policy
> tier no longer exists. See "Handover, take two" at the bottom of this file.

The Safe owning these is an INTERIM step. The end state is the timelocks:

    CUSTODY (48h)  0x63F08A697Cc003d5eA61787712C34438559a7428   Vault, pool managers
    POLICY  (6h)   0x1Da3AD33AB8151Af9EE91b90fA23fFdDFf9C0C3A   fee controllers

Those transfers are two-step as well, and a timelock can only accept through a
queued proposal — which is exactly why the Safe goes first: it accepts in
minutes, where a timelock would have left the Vault on a single hot key for 48
hours.

Still outstanding after this batch: the pool managers have no `pendingOwner` at
all (`09_TransferPoolManagerOwner` has not been run).

## robinhood-handover-to-timelocks.json

> **EXECUTED, then SUPERSEDED 2026-09-12.** This batch landed and both timelocks
> it targets were retired afterwards. Its seven queued operations were still live
> on chain on 2026-09-12 — the four policy ones READY, the three custody ones
> maturing 2026-09-13 12:20:54 UTC. "Handover, take two" below undoes it. Do not
> import this file again.

The last governance step: the Safe hands every contract to the timelock that
should own it, and starts the delay clock in the SAME transaction.

Fifteen calls — eight `transferOwnership`, seven `schedule`. All fifteen were
simulated from the Safe before this file was written; 15/15 succeed.

| tier | delay | contracts |
|---|---|---|
| CUSTODY `0x63F0…7428` | 48h | Vault, CLPoolManagerOwner, BinPoolManagerOwner |
| POLICY `0x1Da3…0C3A` | 6h | CLProtocolFeeController, BinProtocolFeeController, LatchProtocolFeeController, CLPositionDescriptor, UniversalRouter |

**Why the schedules are in the same batch.** Every one of these is
`Ownable2Step`, so `transferOwnership` only nominates and the timelock must call
`acceptOwnership()` itself — which, being a timelock, it can only do through a
queued proposal. Queuing in a second Safe transaction would mean the 48 hours
does not even *start* until someone comes back and signs again. Bundling the
`schedule()` calls starts the clock now.

`CLPositionDescriptor` is plain `Ownable`, not 2-step, so it transfers outright
and has no schedule. That is the one contract in this batch that is finished the
moment the batch lands.

### After the delay

Execute the queued operations with the matching
`execute(target, 0, 0x79ba5097, 0x0, <salt>)` on each timelock — policy after
6h, custody after 48h. The salts are recorded in the batch and are
`keccak256("latch.handover.<ContractName>")`, so they can be re-derived rather
than looked up.

**Correction, 2026-09-12: that derivation is only true for four of the seven.**
The salts embedded in the file for `CLProtocolFeeController`,
`BinProtocolFeeController` and `LatchProtocolFeeController` (`246be49e…`,
`f792e2a6…`, `ef992846…`) do not equal `keccak256("latch.handover.<Name>")`.
Always take salts from the batch file, never from the rule. The operation ids
below were computed from the embedded salts and confirmed against
`isOperationPending` on each retired timelock.

---

# Handover, take two — 2026-09-12

The 2026-09-12 redeploy replaced the custody timelock and abolished the Policy
tier, but the executed handover above had already left **seven live
nominations** pointing at the retired timelocks, plus seven queued
`acceptOwnership` operations on those timelocks. Read on chain 2026-09-12
17:42 UTC (block timestamp 1789234922), all seven `owner()` = Safe:

| contract | `pendingOwner()` | retired timelock's queued accept |
|---|---|---|
| Vault `0x78e8…fB6c` | retired custody `0x63F0…7428` | Waiting, ready at **1789302054 = 2026-09-13 12:20:54 UTC** |
| CLPoolManagerOwner `0x5D71…9a67` | retired custody | same |
| BinPoolManagerOwner `0x9892…2665` | retired custody | same |
| CLProtocolFeeController `0xb1cC…e64B` | retired policy `0x1Da3…0C3A` | **READY since 1789150854** |
| BinProtocolFeeController `0x320f…84af` | retired policy | **READY** |
| LatchProtocolFeeController `0x2a03…154c` | retired policy | **READY** |
| UniversalRouter `0x2220…736c` | retired policy | **READY** |

and one contract that already moved, because it is plain `Ownable`:

| contract | `owner()` | table says |
|---|---|---|
| CLPositionDescriptorOffChain `0x0af0…44eb` | retired policy timelock | Safe |

Both retired timelocks have `EXECUTOR_ROLE` open to `address(0)`. So the four
policy operations can be executed by **anyone, right now**, and the three
custody ones by anyone from 2026-09-13 12:20:54 UTC. Executing the Vault one
hands `registerApp` to a timelock with no independent canceller and no
`updateDelay` floor. That is the clock this section runs against.

## Does a stale nomination have to be cancelled first? No.

Verified against the vendored source, not memory:
`packages/core/lib/openzeppelin-contracts` is **v5.0.2**, and
`Ownable2Step.transferOwnership` is

    function transferOwnership(address newOwner) public virtual override onlyOwner {
        _pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner(), newOwner);
    }

— an unconditional overwrite ("Replaces the pending transfer if there is one").
Every contract in this section inherits exactly that: Vault and both
`ProtocolFeeController`s directly, both pool-manager owners via `PausableRole`,
`LatchProtocolFeeController` directly, `UniversalRouter` via `StableSwapRouter`.
No override of `transferOwnership`/`acceptOwnership` exists in any `src/`. A new
nomination therefore replaces the old one; nothing on the target needs clearing.

The **timelock side** is different. The queued `acceptOwnership` operations on
the retired timelocks are not cleared by anything the target does — they simply
start reverting once `pendingOwner` changes. They are cancelled explicitly
anyway (the Safe holds `CANCELLER_ROLE` on both, as OZ grants it to proposers),
because a live-but-reverting operation is a trap for the next nomination.

## Simulated before publishing

Replayed on a local anvil fork of Robinhood at block 61301600, impersonating the
Safe, every call in file order: **24 of 24 succeed** (9 custody, 13 policy, 2
pausable). Afterwards all seven cancelled ids read `isOperationPending == false`
on the retired timelocks, the new timelock's Vault op reads `Waiting`, and a
stranger's `execute` of the retired custody accept reverts
`TimelockUnexpectedOperationState` even after its original maturity. Warping
past 48h and executing the three accepts as an arbitrary address moved all three
`owner()`s to `0x3ae354e2…E119` with `pendingOwner()` cleared, and left
`CLPoolManager.owner()` / `BinPoolManager.owner()` on their wrappers. The 6h
descriptor reclaim executed the same way and left the descriptor with the Safe.
Nothing was broadcast.

## The two batches, and why they are two

| Safe nonce | file | what it fixes | griefable? |
|---|---|---|---|
| **first** | `robinhood-repoint-custody-to-new-timelock.json` | Vault, both pool-manager owners → NEW custody timelock | only after 2026-09-13 12:20:54 UTC |
| **second** | `robinhood-clear-policy-nominations.json` | four Safe-tier contracts, descriptor reclaim | **yes, right now** |

Safe executes strictly in nonce order and a failed `execTransaction` (GS013)
blocks everything behind it until an on-chain rejection lands (see
`robinhood-deployment.md`). The policy batch can be made to fail by any
stranger who executes one of the four READY operations before it lands — the
contract's owner flips to the retired timelock and the Safe's
`transferOwnership` reverts. The custody batch cannot be griefed for another
~18 hours. So the custody batch takes the lower nonce: if the policy batch is
griefed, the Vault fix has already landed and only the cleanup is blocked.

One combined batch would put the Vault behind that grief. Not worth it.

**Immediately before signing either batch**, re-read; if anything differs from
the table above, stop and regenerate rather than sign:

    RPC=https://rpc.mainnet.chain.robinhood.com
    for a in 0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c 0x5D7111d6c624e9a08aE63d342E4baE5878989a67 \
             0x98920e33313257Ffd942f94379A7ced216462665 0xb1cC5BDBADD19a2430131EaE332afD72fF6be64B \
             0x320feB54e940741AeB037E3944F2C95afAEE84af 0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c \
             0x2220dF8ec6CABC7f2074bC1e56DA092B765f736c; do
      echo "$a owner=$(cast call $a 'owner()(address)' --rpc-url $RPC) pending=$(cast call $a 'pendingOwner()(address)' --rpc-url $RPC)"
    done

Every `owner` must still be the Safe. (Keyless Robinhood RPCs rate-limit hard;
`Multicall3` at `0xcA11bde05977b3631167028862bE2a173976CA11` folds all of this
into one request if you need it.)

Also check the Safe queue: `nonce()` read 4 on 2026-09-12 and
`robinhood-deployment.md` recorded a duplicate batch parked at nonce 4. If it is
still there it must be rejected before either of these can execute.

## robinhood-repoint-custody-to-new-timelock.json — nonce FIRST

Nine calls, all value 0. Decode any of them with
`python ops/safe/decode-batch.py ops/safe/robinhood-repoint-custody-to-new-timelock.json`.

| # | to | call |
|---|---|---|
| 1 | Vault | `transferOwnership(0x3ae354e2…E119)` |
| 2 | CLPoolManagerOwner | `transferOwnership(0x3ae354e2…E119)` |
| 3 | BinPoolManagerOwner | `transferOwnership(0x3ae354e2…E119)` |
| 4 | NEW timelock | `schedule(Vault, 0, 0x79ba5097, 0x0, keccak256("latch.handover.v2.Vault"), 172800)` |
| 5 | NEW timelock | `schedule(CLPoolManagerOwner, 0, 0x79ba5097, 0x0, keccak256("latch.handover.v2.CLPoolManagerOwner"), 172800)` |
| 6 | NEW timelock | `schedule(BinPoolManagerOwner, 0, 0x79ba5097, 0x0, keccak256("latch.handover.v2.BinPoolManagerOwner"), 172800)` |
| 7 | retired custody | `cancel(0x2cf9ecf2…140a)` — its queued Vault accept |
| 8 | retired custody | `cancel(0x99b0275c…0888)` — its queued CLPoolManagerOwner accept |
| 9 | retired custody | `cancel(0x4dab5cb3…103d)` — its queued BinPoolManagerOwner accept |

**Salt and predecessor discipline.** OZ's operation id is
`keccak256(abi.encode(target, value, data, predecessor, salt))`. The three
schedules already differ by `target`, so they could not collide even with equal
salts; distinct salts (`latch.handover.v2.<Name>`) are used anyway so each id is
re-derivable from its name alone and never confused with the retired
timelock's `latch.handover.<Name>` ids. `predecessor = 0x0` on all three: the
accepts are independent and must not gate one another — a predecessor chain
would let one failed accept strand the other two. `delay = 172800` is exactly
`getMinDelay()` on the new timelock (read 172800, `tier() == 0` Custody); OZ
rejects anything lower with `TimelockInsufficientDelay`.

The Vault id was cross-checked: local computation and the timelock's own
`hashOperation(...)` both return
`0xb04e05ca3f8018246e91f8c15d2d3e4f2108afb9b44b3961e90573f026d5f33d`, and
`getOperationState` on it is `0` (Unset) — no collision with anything queued.

**Order inside the batch** is not load-bearing; MultiSend is atomic and none of
the nine calls reads state another one writes (`schedule` does not inspect the
target). Order across batches is load-bearing, as above.

**Deadline.** Before 1789302054 (2026-09-13 12:20:54 UTC). After it, any address
can execute the retired accepts and every call in this file reverts.

### 48 hours later — the second step, and it is permissionless

Nothing in the batch moves ownership. Until the timelock executes its accept,
`owner()` is still the Safe and `pendingOwner()` is the new timelock — that is
the state a block explorer will show for two days, and it is correct, not
finished. The clock starts at the block timestamp in which the Safe batch
executes and runs `172800` seconds; `getTimestamp(id)` on the new timelock
gives the exact readiness time per operation.

`EXECUTOR_ROLE` is `address(0)`, so anyone — the ops key, the keeper, a
stranger — sends these to `0x3aE354e2cdFB9Cb855ABA41c825F6Ee53f28e119`:

    # Vault
    0x134008d300000000000000000000000078e8359c6d34df797b8a793de8c7c6bffa97fb6c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000e17bfec589d6a2594c2d59f7a1455e637425f2d5a4cbbcdf9062e39fad16e555000000000000000000000000000000000000000000000000000000000000000479ba509700000000000000000000000000000000000000000000000000000000
    # CLPoolManagerOwner
    0x134008d30000000000000000000000005d7111d6c624e9a08ae63d342e4bae5878989a67000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000b0ecc7113374d7c91a718f0d7a67a59bbf2efaaaf0f6c3a209b541cb4e3de097000000000000000000000000000000000000000000000000000000000000000479ba509700000000000000000000000000000000000000000000000000000000
    # BinPoolManagerOwner
    0x134008d300000000000000000000000098920e33313257ffd942f94379a7ced216462665000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000004787d44da9b61fa3107ab9bd0ef45f807be8debdaa46b66a2ae96ceb458a62c1000000000000000000000000000000000000000000000000000000000000000479ba509700000000000000000000000000000000000000000000000000000000

Each is `execute(target, 0, 0x79ba5097, 0x0, salt)` — confirm with
`cast 4byte-decode <data>` before sending. Then read `owner()` on all three;
expect `0x3aE354e2cdFB9Cb855ABA41c825F6Ee53f28e119`, and `pendingOwner()` of
`0x0`.

**The 48-hour window is the last cheap moment for two `onlyOwner` calls on the
pool-manager owners**, because after the accept lands they become 48h queued
operations:

- `robinhood-wire-fee-controller.json` — never executed;
  `protocolFeeController()` reads `0x0` on both pool managers.
- `robinhood-grant-pausable-role.json` — the table assigns the pausable role to
  Ops; `hasPausableRole(0x304b…c9a9)` reads `false` on both wrappers. Optional,
  two calls, pause-only power.

Either can go at any nonce after the custody batch, as long as it executes
before the timelock's accepts do.

## robinhood-clear-policy-nominations.json — nonce SECOND

Thirteen calls, all value 0. The destination for all of these is **the Safe**,
which already owns them; the work is clearing what points elsewhere.

| # | to | call |
|---|---|---|
| 1–4 | retired policy | `cancel(id)` for the four READY accepts |
| 5, 6 | CLProtocolFeeController | `transferOwnership(Safe)`, then `acceptOwnership()` |
| 7, 8 | BinProtocolFeeController | same |
| 9, 10 | LatchProtocolFeeController | same |
| 11, 12 | UniversalRouter | same |
| 13 | retired policy | `schedule(CLPositionDescriptor, 0, transferOwnership(Safe), 0x0, keccak256("latch.reclaim.CLPositionDescriptor"), 21600)` |

**Why nominate-then-accept rather than a single call.** The Safe is already
owner. `transferOwnership(Safe)` overwrites the stale `pendingOwner`;
`acceptOwnership()` from the Safe runs `_transferOwnership`, which
`delete`s `_pendingOwner`. End state `owner = Safe, pendingOwner = 0`, and the
`OwnershipTransferred(Safe, Safe)` event is the on-chain record that it was
deliberate. `transferOwnership(address(0))` would reach the same state in one
call — `Ownable2Step` has no zero check — but a transfer-to-zero in a signing
UI reads like a renounce, and CLAUDE.md tells signers to reject that selector
on sight. Two unambiguous calls beat one that needs a footnote.

**Why the descriptor needs a schedule.** `CLPositionDescriptorOffChain` is
plain `Ownable` (`pendingOwner()` reverts on it), so the earlier batch's
`transferOwnership` moved it outright to the retired policy timelock. Getting it
back means that timelock must call `transferOwnership(Safe)` itself, which
means a queued operation at its `getMinDelay()` of 21600. Ownership moves at
execution; no accept.

### 6 hours later

Anyone sends to `0x1Da3AD33AB8151Af9EE91b90fA23fFdDFf9C0C3A`:

    0x134008d30000000000000000000000000af03bee134ce66ee12425ee05a50f32c72644eb000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000925afbaadb7078ce4ee0b381e642b14bf72bf6026116efc72df216a3c5cfe86d0000000000000000000000000000000000000000000000000000000000000024f2fde38b000000000000000000000000715a6176946adbd22c1b2021d321fb3767ca343200000000000000000000000000000000000000000000000000000000

Operation id `0x2096cb18b4aafbe051f029e853dd9caf26bf08164cbb8eee1f6f53b7ee67ec5e`
(`getOperationState` read `0` before scheduling). Then
`owner()` on `0x0af03bee134ce66ee12425ee05a50f32c72644eb` must be the Safe.

### If this batch is griefed

A stranger executed one of the four READY operations first. Symptom: that
contract's `owner()` is `0x1Da3AD33…` and the Safe batch reverts with GS013.
Recovery is the descriptor pattern: reject the stuck nonce, remove that
contract's two calls and its `cancel` from the batch, and add a
`schedule(<contract>, 0, transferOwnership(Safe), 0x0, <fresh salt>, 21600)`
on the retired policy timelock; six hours later execute it, then the Safe calls
`acceptOwnership()` on the contract (these are `Ownable2Step`, unlike the
descriptor). Nothing is lost — the retired policy timelock still has the Safe as
sole proposer — but it costs a day.

## Verifying afterwards, per contract

| contract | `owner()` right after both batches | `pendingOwner()` | final `owner()` |
|---|---|---|---|
| Vault | Safe | NEW timelock | NEW timelock, after execute at +48h |
| CLPoolManagerOwner | Safe | NEW timelock | NEW timelock, after execute at +48h |
| BinPoolManagerOwner | Safe | NEW timelock | NEW timelock, after execute at +48h |
| CLProtocolFeeController | Safe | `0x0` | Safe |
| BinProtocolFeeController | Safe | `0x0` | Safe |
| LatchProtocolFeeController | Safe | `0x0` | Safe |
| UniversalRouter | Safe | `0x0` | Safe |
| CLPositionDescriptor | retired policy timelock | n/a | Safe, after execute at +6h |

And on both retired timelocks, `isOperationPending(id)` must read `false` for
all seven cancelled ids.

## What was checked and already matches the table

Read on chain 2026-09-12, no action needed: `RevShareHook` (new,
`0xfC00…2aD2`) `owner` = Safe, `pendingOwner` = 0, `guardian` = ops key.
`LatchRegistry` v2 (`0xb2c8…88CC`) `DEFAULT_ADMIN_ROLE` = Safe only,
`CURATOR_ROLE` and `GUARDIAN_ROLE` = ops key. `LatchLaunchRegistry`,
`LaunchGuardHook`, `LaunchpadKit` have no owner. NEW timelock: `getMinDelay`
172800, `tier` Custody, `PROPOSER_ROLE` = Safe only, `EXECUTOR_ROLE` =
`address(0)`, `CANCELLER_ROLE` = the canceller `0xe65F…1142` and (OZ default,
documented as intended) the Safe, `DEFAULT_ADMIN_ROLE` = itself only. The
retired `RevShareHook` `0x23CE…E446` is also Safe-owned and stays that way.
