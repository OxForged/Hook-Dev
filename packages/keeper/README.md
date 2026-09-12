# @latchprotocol/keeper

The protocol has four maintenance calls that **somebody** has to make.

| Call | What happens if nobody makes it |
|---|---|
| `closeEpoch()` | Revenue accrues in the distributor and no epoch ever closes. Nobody can claim anything. |
| `rollover(epochId)` | An expired epoch's unclaimed funds sit stranded instead of returning to the next epoch. |
| `settleBeneficiaries(key, currency)` | Fees accrue against the pool but never reach the beneficiary roster. **This is what happened on Robinhood**: ~2.39e15 wei of each of LTT1 and LTT2 sat in `pendingBeneficiary` from the first swap until this keeper was configured for chain 4663. |
| `applyPendingConfig(key)` | A config change waits out its delay and then never takes effect. On the current hook a proposal has a WINDOW: past its `expiryBlock` it is dead and the pool owner has to propose again. On the legacy hook it has no expiry and stays armed. |

All four are **permissionless** — any address may call them. That is a deliberate design property: it means the protocol cannot be stalled by an owner who proposed something and walked away. It also means this keeper needs no privileged role at all.

Bringing it up on a host: **[RUNBOOK.md](./RUNBOOK.md)**.

## What a stolen keeper key buys an attacker

**Nothing they could not already do from any address.**

Every function in `src/abi.ts` is permissionless on chain. There is no owner-only, curator-only or guardian-only call in this process, and none should ever be added — if a future job needs a privileged role, it does not belong in this package. The keeper key should be a dedicated address holding only gas.

Concretely: an attacker with the key can close an epoch slightly earlier than you would have, or waste your gas. They cannot move funds to themselves, change a fee, alter a roster, or touch a listing.

## Running it

```bash
npm install && npm run build

# Report only. Safe anywhere, needs no key.
node dist/index.js --config keeper.config.robinhood.json --once

# Actually send. Requires BOTH the flag and the key.
KEEPER_PRIVATE_KEY=0x... node dist/index.js --config keeper.config.robinhood.json --execute
```

Two independent conditions gate sending: `--execute` **and** `KEEPER_PRIVATE_KEY`. Either alone produces a dry run. This is belt-and-braces on purpose — the likeliest operational mistake is running the wrong command in the wrong place.

Flags: `--config <path>` (default `keeper.config.json`), `--once`, `--execute`, `--interval <seconds>` (default 300, minimum 15).

At startup the keeper reads `eth_chainId` from the RPC and **refuses to start if it differs from `chainId` in the config**. Every address in a config is meaningful on exactly one chain; on any other, every read returns zeros and every "nothing pending" is a lie.

## Configuration

Tracked configs:

| File | Chain | What it watches |
|---|---|---|
| `keeper.config.robinhood.json` | Robinhood Chain (4663), mainnet | The LTT1/LTT2 pool on the retired `RevShareHook 0x23CE34E8…`. No distributor exists on this chain, and the config says so with `"distributor": null`. |
| `keeper.config.example.json` | Sepolia, placeholder | Ships with a zero-address hook on purpose so a copy-paste run fails at startup. |

`keeper.config.json` is gitignored and is where a local, personal config goes.

The config is validated strictly at startup — a malformed address stops the process with a clear message rather than surfacing hours later as a transaction sent somewhere unexpected. Beyond the obvious shape checks it enforces four things that were learned the hard way:

- **`poolId` must equal `keccak256(abi.encode(poolKey))`.** Every write takes the KEY and the hook hashes it. A key that does not hash to the id names a pool that does not exist — and `settleBeneficiaries` on a non-existent pool does not revert, it returns. The keeper would pay for that on every tick.
- **`hook` must equal `poolKey.hooks`**, for the same reason.
- **`currencies` must be the pool's own.** `pendingBeneficiary` for any other currency is always zero.
- **`distributor` is required: an address or `null`.** An absent key used to mean "skip the epoch jobs", which is indistinguishable in the logs from "somebody forgot". `null` is a statement, and the close-epoch job cross-checks it against `distributorOf(poolId)` on the hook every tick, so a distributor that appears on chain and not in the config is reported rather than left to strand epochs.

One target per **pool**, not per hook. Every call this keeper makes takes a `PoolKey`, so a hook with no pools has nothing to be called on; that is why the current Robinhood hook `0xfC00485A…` is named in the config's `notes` and not in `targets`. A keeper process serves as many hooks as its targets name — `hook` is a per-target field. What it does not do is discover pools: when a pool is configured on a hook, somebody adds a target.

Other keys: `maxGas` (refuse a clean simulation that estimates above this), `disabledJobs` (job ids to skip), `rpcBatch` (default `true`; fold a tick's reads into JSON-RPC batch requests, which is what makes a tick fit under the public Robinhood RPCs' request-count rate limits), `notes` (printed at startup).

## Why it simulates before every send

Each job calls `simulateContract` first and only broadcasts if that succeeds. If `maxGas` is set it then estimates, and a clean simulation that estimates above the cap is refused and reported.

Every contract-side guard — `EpochTooSoon`, `NothingToDistribute`, `AlreadyRolledOver`, `NotExpiredYet` — is a revert. A keeper firing on a timer would pay gas to discover each of them. Simulating turns all of them into free reads, and a revert is read as *"not due"*, which is the normal state most of the time.

One job needs extra care: **`settleBeneficiaries` does not revert when it is pointless.** It has two silent early returns — a zero pot, and an empty roster (`totalWeight == 0`). The job reads both before it simulates. A pot with nobody to pay is reported as a failure needing the pool owner, not sent.

## Telling the two distributors apart

Both distributors implement `IEpochDistributor.kind()`, which returns one of two domain-separated constants (`keccak256("latch.revshare.distributor.snapshot.v1")` / `…merkle.v1`). The keeper calls it, requires an exact match, and treats anything else — zero, a revert, an unrecognised hash — as `unknown`, on which the rollover job refuses to act. It no longer probes `token()`/`challengeDelay()`: any contract with a `token()` getter passes that probe.

This matters because `getEpoch` returns nine all-static fields on both, so the wrong ABI decodes without error into nonsense (`root` as `totalVotingSupply`, `claimableAt` as `closedAt`). A distributor deployed before `kind()` existed — the Sepolia one at `0x5A908Ad9…` is one — is reported as `unknown` and its rollovers are left alone. That is the honest outcome, not a bug to route around.

Rollover deadlines are not recomputed off chain. On the merkle distributor an epoch is governed by one of two clocks depending on whether a root ever landed, `cancelRoot` moves one of them, and `getEpoch` does not record that it did; `rolloverEligibleAt(id)` is the one view that knows, so the job schedules on that. The snapshot distributor has no such view and its `expiresAt` is the whole story.

## Two hook shapes on chain

`getPendingConfig` returns a 7-word struct on the hooks deployed before proposal expiry existed (Robinhood `0x23CE…`, Sepolia `0x1C86…`) and an 8-word struct on the current source. The job calls it raw and decodes by returned length; the 7-word shape has no `expiryBlock` and the job says so. Decoding either shape with the other's ABI is wrong — one throws on every tick, the other silently reads `feePips` as `expiryBlock`.

## Design notes

- **Jobs are idempotent.** Every pass re-reads chain state. A missed tick costs nothing; a repeated one is a no-op. That is why the loop is a plain interval rather than a backoff state machine.
- **A transient RPC failure never exits the process.** That is precisely when a keeper most needs to still be running.
- **The key is never logged**, never included in an error message, and never written to disk. `readPrivateKey()` will not echo it even as a prefix when rejecting a malformed value.
- **The ABI is deliberately narrow.** If a function is not in `src/abi.ts`, this process cannot call it, whatever a bug or a bad config asks for.
- **One send path.** Every write goes through `jobs/send.ts`, so simulate-first, the gas cap and the dry-run gate are enforced in one place.

## Tests

```bash
npm test        # builds, then runs test/*.test.mjs with node:test — no chain, no network
npm run typecheck
```

The tests pin the `kind()` constants byte for byte against the Solidity strings, exercise both `getPendingConfig` shapes including the misread they exist to prevent, reproduce the live Robinhood and Sepolia pool ids from their keys, and drive every config rejection.

## What this is not

It is not an AI agent, and it does not need to be. Every decision here is a comparison against on-chain state with an exact answer. See `LatchAI` for the agent-facing surface; a keeper is the boring, reliable half and should stay that way.
