# @latchprotocol/keeper

The protocol has four maintenance calls that **somebody** has to make.

| Call | What happens if nobody makes it |
|---|---|
| `closeEpoch()` | Revenue accrues in the distributor and no epoch ever closes. Nobody can claim anything. |
| `rollover(epochId)` | An expired epoch's unclaimed funds sit stranded instead of returning to the next epoch. |
| `settleBeneficiaries(key, currency)` | Fees accrue against the pool but never reach the beneficiary roster. **This is what happened on Robinhood**: ~2.39e15 wei of each of LTT1 and LTT2 sat in `pendingBeneficiary` from the first swap until this keeper was configured for chain 4663. |
| `applyPendingConfig(key)` | A config change waits out its delay and then never takes effect. On hooks with an expiry a proposal has a WINDOW: past it the proposal is dead and the pool owner has to propose again. On the first hook (`0x23CE…`, block-no-expiry) it has no expiry and stays armed. |

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

`getPendingConfig` has THREE layouts: `block-no-expiry` (7 words, Robinhood `0x23CE…`, Sepolia `0x1C86…`), `block-with-expiry` (8 words, Robinhood `0xfC00…`) and `timestamp-with-expiry` (8 words, unix seconds, the Option B build). The two 8-word layouts are identical, so the job no longer decodes by length. It resolves the shape first — the target's optional `"pendingShape"` in config, else the built-in table of deployed hooks, else a `CLOCK_MODE()` probe (answers `"mode=timestamp"` only on the timestamp build; a revert means a block build; a transport error is never read as a revert) — and a target whose shape cannot be established, or whose configured shape contradicts the chain, is skipped with the reason logged. Timestamp proposals are judged against `block.timestamp`, block proposals against the contract block number.

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

## Optional: weekend staleness logger (`latch-feed-watch`)

A second, separate entry point that **only reads**. It polls `latestRoundData()` on a list of Chainlink aggregator proxies every N minutes and appends one JSON line per feed per tick. It exists to measure how stale tokenized-equity feeds actually get out of hours, before anyone chooses a `heartbeat` for `ChainlinkPriceBandAdapter` or a `maxPriceAge` for a pool that halts on staleness.

It is not a keeper job and is not registered in `index.ts`: it reads no key, has no code path that can sign, and its ABI is four view functions (`description`, `decimals`, `aggregator`, `latestRoundData`).

```bash
npm install && npm run build

# One tick, to prove the config and the RPC work.
node dist/feeds.js --config feeds.config.robinhood.json --once

# A whole weekend. Start it Friday before 20:00 UTC, stop it Monday after 01:00 UTC.
node dist/feeds.js --config feeds.config.robinhood.json --interval-minutes 15

# Backfill one past block (needs an archive-capable RPC; see below).
node dist/feeds.js --config feeds.config.robinhood.json --at-block 61950000 --out logs/backfill.jsonl
```

Flags: `--config` (default `feeds.config.robinhood.json`), `--once`, `--interval-minutes <n>` (minimum 1, default from config), `--out <path>` (default from config, `logs/feed-staleness.<chainId>.jsonl`), `--at-block <n>` (read one historical block, tag rows `"historical": true`, exit). `logs/` and `*.jsonl` are gitignored.

**Startup refuses to log a feed that is not the one named.** Before the first tick it checks `eth_chainId`, then for every proxy that `description()` equals `expectedDescription` exactly and that `aggregator()` returns an address with code. Robinhood Chain carries at least one contract that answers the AggregatorV3 read shape and checks nothing (a "SequencerUptimeRouter" hardcoded to UP), so a shape-compatible answer is not evidence of a feed.

### One row

```json
{"ts":"2026-09-14T00:18:38.977Z","chainId":4663,"block":"61950000","blockTimestamp":1789301794,"feed":"SPY/USD","proxy":"0x3197…9f6A","decimals":8,"heartbeatSeconds":86400,"historical":true,"roundId":"18446744073709551742","answer":"76526375000","updatedAt":1789131362,"stalenessSeconds":170432,"heartbeatViolation":true}
```

- `stalenessSeconds` is `blockTimestamp - updatedAt`, chain time, which is what the adapter compares against. `ts` is the local wall clock, kept so a stalled RPC is visible as a gap between the two.
- `heartbeatViolation` is `updatedAt + heartbeatSeconds < blockTimestamp`, the same inequality `ChainlinkPriceBandAdapter._read` reverts `AnswerTooOld` on.
- Every feed is read at the same block in a tick. A failed read still writes a row, with `error` set and the numeric fields `null`, so a hole in the log means the process was down, never that a read failed quietly.
- `answer` and `roundId` are strings: `int256` and `uint80` do not survive a JSON number.

Summarise a weekend with nothing but Node:

```bash
node -e 'const rows=require("fs").readFileSync("logs/feed-staleness.4663.jsonl","utf8").trim().split("\n").map(JSON.parse);
const by={};for(const r of rows){if(r.stalenessSeconds==null)continue;const m=by[r.feed]??={max:0,viol:0,n:0};m.n++;m.max=Math.max(m.max,r.stalenessSeconds);if(r.heartbeatViolation)m.viol++}
for(const [f,m] of Object.entries(by))console.log(f,"rows",m.n,"max staleness h",(m.max/3600).toFixed(1),"violating rows",m.viol)'
```

### RPCs: archive, and rate limits

`feeds.config.robinhood.json` lists `robinhood.rpc.blxrbdn.com` and `rpc-robinhood.blockmachine.io` ahead of the canonical `rpc.mainnet.chain.robinhood.com` on purpose. As probed 2026-09-13, the canonical endpoint prunes state within hours (`--at-block` there fails with "metadata is not found", which viem surfaces as "Missing or invalid parameters"), and `rpc.nodeflare.app/robinhood/public` rate-limits keyless callers to one request per ten seconds, which a four-feed tick exceeds. None of these carry a key; never add one that does to a tracked config.

### What the first measurement showed (2026-09-13, block 61950000, Sunday 12:16 UTC)

All four feeds violated their 86,400 s heartbeat: AAPL 40.4 h, NVDA 40.2 h, TSLA 45.4 h, SPY 47.3 h stale, with last rounds between Friday 12:56 and 20:03 UTC. All four resumed at Monday 00:00 UTC (Sunday 20:00 ET). Inside the session they can also be quiet for a long time: SPY's rounds before that were Thursday 13:52 and Friday 06:48 UTC, a 17 h gap under a 0.5 % deviation threshold. So a `maxPriceAge` much tighter than the heartbeat halts a pool during an ordinary quiet session, and the heartbeat alone keeps serving Friday's price until some time on Saturday. The calendar has to close the weekend; staleness cannot do it by itself.

### Running it beside the keeper, on the shared host

**Not deployed anywhere, and not added to `docker-compose.yml`.** This is how it would be added. The host is shared with unrelated production stacks; CLAUDE.md "Deployment: the host is shared" governs: touch only the `latch` project, always `docker compose -p latch …` from `~/latch/keeper`, never stop or reconfigure a neighbour, publish no ports.

The existing image already contains `dist/feeds.js`, so it needs a second service only, appended under `services:` in `docker-compose.yml`:

```yaml
  feed-watch:
    container_name: latch-feed-watch
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    entrypoint: ["node", "dist/feeds.js"]
    command: ["--config", "/config/feeds.config.json", "--interval-minutes", "15", "--out", "/data/feed-staleness.4663.jsonl"]
    volumes:
      - ./feeds.config.robinhood.json:/config/feeds.config.json:ro
      # The one writable path. A named volume, not a bind mount into somebody else's tree.
      - latch_feed_logs:/data
    # No environment at all: this service must never see KEEPER_PRIVATE_KEY.
    networks: [latch_net]
    logging:
      driver: json-file
      options: { max-size: "5m", max-file: "2" }
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
```

and at the top level:

```yaml
volumes:
  latch_feed_logs:
    name: latch_feed_logs
```

Then, from `~/latch/keeper` only: `docker compose -p latch up -d --build feed-watch`. Read it with `docker compose -p latch exec feed-watch tail -n 4 /data/feed-staleness.4663.jsonl`. Size: four rows every 15 minutes is roughly 150 KB a weekend — negligible, but the host disk was at 82 % when last checked, so copy the file off and remove the volume when the measurement is done rather than leaving it to grow. The image runs as uid 1000; a fresh named volume is root-owned, so if the first tick fails with `EACCES`, create the volume owned by `node` rather than running the container as root.

## What this is not

It is not an AI agent, and it does not need to be. Every decision here is a comparison against on-chain state with an exact answer. See `LatchAI` for the agent-facing surface; a keeper is the boring, reliable half and should stay that way.
