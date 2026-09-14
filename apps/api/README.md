# @latchprotocol/api — the hosted API tier

Latch's second revenue line (CLAUDE.md, "Kit fees"): an **indexer** over the
deployed Latch contracts plus a **public read API** with a rate-limited free tier
and paid **API keys**. It is also the foundation the **admin panel** is built on.

Node 22 · Express 5 · TypeScript (strict) · PostgreSQL via Prisma · Redis · BullMQ · viem.
Chain knowledge (addresses, ABIs, clocks, endpoints) comes from `@latchprotocol/sdk`.

> **Status, 2026-09-13.** Indexes Robinhood Chain (4663) from its deployment block.
> A live read-only run returned both swaps on the LTT1/LTT2 pool (L2 blocks
> 60,244,152 and 60,244,176) and verified `RevShareHook.totalTaken` on both
> currencies. Not deployed anywhere yet; see [Deploying](#deploying-on-the-shared-vps).

---

## 1. What changed, and why

Before this change the service served **fixture data only**. Its README said no
Latch contract was deployed; that stopped being true on 2026-09-11. Findings from
reading the old code:

| Finding | Consequence |
|---|---|
| `CHAIN_PROVIDER=fixture` default; synthetic devnet timeline in `src/` | Every response was invented data behind a disclaimer. CLAUDE.md: a mock seam that still compiles gets wired back up. |
| Hook registry seeded with 8 `kind: EXAMPLE` listings | Invented marketplace data. The real registry is `LatchRegistry` on chain. |
| Contracts discovered from `AppRegistered`/`Initialize`, not the SDK address book | Could not know the fee controller V2, kit, registries, timelocks or RevShareHooks. |
| Cumulative counters incremented on insert | Correct only without reorgs; a reorg could not be undone. |
| `trust proxy = true` | Any client could forge `X-Forwarded-For` (no per-IP limit existed yet, but it would have been bypassable). |
| `POST /api/v1/admin/ingest` behind a shared static token | A public admin HTTP surface with a replayable secret. |
| No keys, tiers, quotas, provenance, candles, revenue, DexScreener, or clock handling | The product did not exist yet. |

The fixture code was **moved, not deleted** (deleting tracked files carrying
another agent's uncommitted edits was refused): superseded modules are under
`apps/api/retired/` for the lead to remove in the commit, and the devnet timeline
survives as test data in `test/fixtures/devnet.ts`. Nothing in `src/` imports
either.

---

## 2. Architecture

```
            ┌────────────── worker (node dist/worker.js) ──────────────┐
 Robinhood  │ index pass ─► snapshot pass ─► governance ─► feeds       │   the ONLY process
 RPCs  ◄────┤  eth_getLogs    eth_call @B     owner()/roles   Chainlink │   that reads chains
 (SDK list) └──────────────────────────┬───────────────────────────────┘
                                       ▼
                         PostgreSQL (range-replaced rows + snapshots)
                                       ▲
            ┌──────── api (node dist/index.js) ────────┐       Redis
 clients ──►│ limits ─► identify ─► rate/quota ─► read  │◄────► cache, rate-limit
            │ /v1 public · /v1/dexscreener · /v1/admin │        counters, usage,
            └──────────────────────────────────────────┘        BullMQ schedules
 operator ─► CLI (npm run admin / admin:prod): keys, accounts, usage, one-off passes
```

Layout:

```
src/
  index.ts  worker.ts  app.ts  cli/admin.ts
  config/   env (zod), logger (redaction), chainConfig (config/chains/<id>.json)
  chain/    deployments (watch set from SDK) · abis (non-SDK ABIs) · decode (pure)
            rpc (worker-only log/block access) · pendingConfig (decode by length)
  indexer/  indexer (pass, spans, applySpan) · rows (pure row builder)
            snapshots (state, tokens, accruals, reconciliation, hazards)
            governance (ownership, ops balances, feeds)
  services/ read (every public read, Postgres only) · candleBuilder (pure) · dexscreener
  http/     middleware · public (/v1) · admin (/v1/admin)
  auth/     keys (mint/hash/verify) · identity (key resolver, usage counters)
  ratelimit/limiter (sliding window, Redis Lua + in-memory fallback)
  admin/    roles (on-chain) · session (cookie, CSRF, audit) · safeTx (payloads)
config/chains/4663.json   public ops config: Chainlink feeds, priced tokens, ops accounts
prisma/   schema.prisma · migrations/
test/     unit tests, fixtures/, integration/ (opt-in)
```

---

## 3. The indexer

### What it watches — all from the SDK address book

| Role (SDK key) | Events |
|---|---|
| `clPoolManager` | `Initialize`, `Swap`, `ModifyLiquidity`, `ProtocolFeeUpdated`, `DynamicLPFeeUpdated` |
| `binPoolManager` | `Initialize`, `Swap`, `Mint`, `Burn`, `ProtocolFeeUpdated`, `DynamicLPFeeUpdated` |
| `vault` | `AppRegistered` (irreversible fund access — admin panel) |
| `feeController` (V2) | `ProtocolFeesCollected` (tx input tells `collect` from `sweep`) |
| `launchpadKit` | `LaunchCreated`, `LaunchSeeded`, `LaunchReconfigured`, `HookListed` |
| `registry` (`LatchRegistry`) | `LatchRegistered`, `LatchListingChanged`, `LatchVerificationChanged`, `LatchMetadataUpdated`, `LatchStewardTransferred`, `RoleGranted`, `RoleRevoked` |
| `launchRegistry` | `LaunchRegistered`, `LaunchTokenInfoUpdated`, `LaunchMetadataUpdated`, `LaunchListingChanged` |
| `timelockCustody`, `timelockPolicy` | `CallScheduled`, `CallExecuted`, `CallSalt`, `Cancelled`, `MinDelayChange` |
| Latch's own RevShareHooks | `RevShareTaken`, `Claimed` |

Core event ABIs come from the SDK (`decodeProtocolLog`, `LAUNCHPAD_KIT_ABI`,
`LATCH_HOOK_REGISTRY_ABI`). RevShareHook, fee-controller V2, launch-registry and
timelock ABIs are not in the SDK; they are declared in `src/chain/abis.ts` and
diffed against the Foundry artifacts by `test/abis.test.ts`.

**Only Latch's own RevShareHooks are summed**, the same rule as the landing page:
the SDK's `revShareHook` plus the hook the SDK reference pool is bound to, read
from that pool's `Initialize` (on Robinhood, the retired `0x23CE…E446`). A
third-party contract can emit an identical signature with any numbers.

Decoding is keyed on **emitting address → role**, never topic0 alone.

### A pass

```
head = eth_blockNumber (worker observation)      safeHead = head - INDEX_CONFIRMATIONS (100)
checkpoint block hash re-read; changed => reorg deeper than confirmations: rewind 10,000, record it
start = checkpoint + 1 - INDEX_REINDEX_WINDOW (2,000)          [trailing window always re-read]
for each span [from, to] (up to 500,000 blocks; halves on refusal, min 1,000):
  phase 1  eth_getLogs(address-book contracts, watched topics)
  phase 2  eth_getLogs(our RevShareHooks, RevShareTaken|Claimed)      (hook found in phase 1)
  join     block timestamps; tx `from` (swaps) and input (fee collections)
  build    rows — PURE (src/indexer/rows.ts)
  ONE TRANSACTION: pg_advisory_xact_lock(chain) · checkpoint guard ·
                   DELETE [from,to] · INSERT · advance checkpoint (block, hash, timestamp)
```

- **Idempotent.** Replaying a span deletes and re-inserts identical rows. No
  counter is ever incremented; totals are aggregated at read time.
- **Reorg-safe.** Confirmations keep most out; the re-read window repairs shallow
  ones (rows the chain no longer reports disappear); the checkpoint-hash check
  catches deeper ones and is recorded in `reorg_events`. It also repairs a public
  endpoint that answered short because it lagged the head.
- **Resumable.** The checkpoint moves only inside the transaction that wrote its span.
- **Single writer.** Advisory lock plus a checkpoint guard: a second worker's pass
  fails with `ConcurrentPassError` instead of interleaving.
- **Multi-chain.** Per-chain checkpoint; `INDEX_CHAIN_IDS` lists chains; each must be
  in the SDK book. A changed address set (an SDK redeploy entry) re-reads history
  from `deployedAtBlock`.
- **RPC.** SDK `resolveEndpoints` (`LATCH_RPC_<chainId>` first, then the probed
  public list). Each endpoint is asked for the whole span in one request, and the
  one that answers is preferred next time — `rpc.mainnet.chain.robinhood.com`
  served the full 2.4M-block history in one request on 2026-09-13.

### Clocks

Log block numbers and ranges are the **L2 clock** (`eth_blockNumber`). Any
**contract-stored** block number — `LaunchCreated.startBlock`, RevShareHook
`effectiveBlock`/`expiryBlock` — is stored as `*ContractBlock` and compared only
against the SDK's `readContractClock` reading (on Robinhood, Ethereum L1's block
number, ~12 s), taken by the worker and stored on the checkpoint. Launch phases
use SDK `blockWindowPhase` and `contractBlocksToSeconds`.

### Units, fees, USD

- Raw token units are `NUMERIC(78,0)`, served as decimal strings, plus decimalized
  strings computed with bigint arithmetic. No floats.
- **Swap direction:** `Swap.amount0/amount1` are the **caller's** delta, negative =
  paid in; `amount0 < 0` ⇒ currency0 in (SDK `indexer.swapIsZeroForOne`). Verified
  on tx `0x68286e9b…629a` (amount0 = −1e18; exactly 1e18 LTT1 entered the Vault).
- **Fees per swap, from its own fields:** `feeTotal = amountIn·fee/1e6`,
  `feeProtocol = amountIn·protocolFee/1e6`, `feeLp = feeTotal − feeProtocol` (floored).
- **USD only from a Chainlink read.** `config/chains/4663.json` maps a token to a
  feed. Robinhood stock tokens are scaled by `uiMultiplier`:
  `USD per token = answer/10^decimals × uiMultiplier/1e18`. Every USD figure
  carries feed, answer, `feedUpdatedAt`, read block, multiplier and method, and is
  withheld (with a reason) when the feed breaches its heartbeat or the multiplier
  is unread. Historical volume is never multiplied by a current price.

### Reconciliation

`RevShareHook.totalTaken(poolId, currency)` must equal the indexed
`RevShareTaken` sum at the same block, for every (hook, pool, currency) on our
hooks — including pools with no logs. Every `RevShareTaken` must share a
transaction with a `Swap`. Results: `VERIFIED` / `MISMATCH` / `UNAVAILABLE`
(hook predates the counter) / `ERROR` (RPC). Creator-revenue responses carry the
state in `provenance.reconciled`. No on-chain counter reconciles swap protocol-fee
slices exactly (per-step rounding), so that response says `not-applicable` and
shows `protocolFeesAccrued` and collections beside it.

### Snapshots (worker, pinned to the checkpoint block)

Pool state (`getSlot0`, `getLiquidity`), token metadata (address book first, then
ERC-20 reads, plus `uiMultiplier`), `protocolFeesAccrued` per manager × token,
reconciliation, `getPendingConfig` hazards (decoded by return length, judged on
the contract clock; a failed read is `UNKNOWN`, never `NONE`), ownership vs the
CLAUDE.md table, ops-account balances, Chainlink staleness.

---

## 4. Data model (`prisma/schema.prisma`)

| Group | Tables |
|---|---|
| Bookkeeping | `chains`, `indexer_checkpoints`, `indexer_runs`, `reorg_events` |
| Log-derived (range-replaced) | `pools`, `swaps`, `liquidity_events`, `pool_fee_updates`, `revshare_takes`, `revshare_claims`, `protocol_fee_collections`, `launches`, `contract_events`, `timelock_events`, `revenue_ledger` |
| Snapshots | `tokens`, `pool_states`, `protocol_fee_accrual_snapshots`, `feed_observations`, `reconciliations`, `ownership_snapshots`, `pending_config_hazards`, `ops_balances` |
| Moderation | `listing_submissions` (status, private contact, icon asset ref, reviewer, notes) |
| Admin auth | `admin_nonces`, `admin_sessions`, `audit_log` |
| Keys and billing hook | `api_accounts` (`plan`, `billingProvider`, `billingCustomerId`), `api_keys`, `api_usage_monthly` |

`revenue_ledger` sources: `PROTOCOL_FEE_COLLECTED`, `PROTOCOL_FEE_SWEPT`,
`REVSHARE_PROTOCOL_CLAIM` (a `Claimed` whose beneficiary is the governance Safe)
are written today. `LP_LOCKER_PROTOCOL_CLAIM`, `LP_LOCKER_INTEGRATOR_CLAIM` and
`KIT_LAUNCH_FEE` are defined extension points with no indexer yet (no deployed
contract / no ABI in the SDK). `usdValue`/`usdSource`/`usdPricedAt` are nullable
and stay null until a real feed prices that token.

Migrations: `prisma/migrations/20260913000000_init`. Apply with `npm run db:deploy`.

---

## 5. Public API — `/v1`

Every response body is `{ data, provenance, page? }` (DEX Screener responses keep
their own top-level keys and add `provenance` plus an `X-Latch-Provenance` header):

```json
"provenance": {
  "chainId": 4663, "source": "latch-indexer",
  "fromBlock": "60111836", "toBlock": "62509876", "toBlockTimestamp": "…",
  "indexerLag": { "blocks": "100", "headBlock": "62509976", "headObservedAt": "…" },
  "reconciled": { "state": "verified|mismatch|partial|pending|not-applicable", "atBlock": "…", "checks": 3 },
  "generatedAt": "…", "notes": ["…"]
}
```

| Route | Notes |
|---|---|
| `GET /health/live`, `/health/ready` | Orchestrator probes. No auth, no limit. |
| `GET /v1/health` · `/v1/chains/:chainId/health` | Indexed block, observed head, lag, last run per job, reconciliation counts, contract clock, reorgs. |
| `GET /v1/chains` | Chains and indexed-to block. |
| `GET /v1/chains/:chainId/tokens[?search]` · `/tokens/:address` | Metadata, stock-token multiplier, USD with full source. |
| `GET /v1/chains/:chainId/pools[?token&hook]` · `/pools/:poolId` | Config (fee, dynamic, tick spacing / bin step), hook address + decoded bitmap, state and price from `getSlot0` at a stated block. |
| `GET /v1/chains/:chainId/pools/:poolId/swaps` | Keyset pagination (≤200). |
| `GET /v1/chains/:chainId/pools/:poolId/candles?interval=1m\|5m\|15m\|1h\|4h\|1d&from&to[&invert]` | OHLCV in token units. **There is no candle for an interval with no trades.** Price = per-swap execution price (quote per base, includes LP fee and impact). Caps: 1,500 intervals, 50,000 swaps. |
| `GET /v1/chains/:chainId/volume?window=24h\|7d\|30d\|all[&poolId]` | Per input token: swaps, volume in, fees total / LP / protocol. Window ends at the last indexed block. |
| `GET /v1/chains/:chainId/revenue/creators` | `RevShareTaken` sums with lifetime `totalTaken` reconciliation per pair. |
| `GET /v1/chains/:chainId/revenue/protocol` | Swap protocol-fee slices, `ProtocolFeesCollected` by method, latest `protocolFeesAccrued`. |
| `GET /v1/chains/:chainId/launches` · `/launches/:poolId` | Kit launches; schedule on the contract clock with phase and time estimate; kit and launch-registry history. |
| `GET /v1/chains/:chainId/latches/:address/registry` | What `LatchRegistry` events say. Explicitly not an audit. |
| `GET /v1/dexscreener/:chainId/latest-block` · `/asset?id=` · `/pair?id=` · `/events?fromBlock&toBlock` | DEX Screener adapter (below). |

**DEX Screener.** Shape per their "Adapter Specs" (`/latest-block`, `/asset`,
`/pair`, `/events`). The spec page is JS-rendered Notion and could not be fetched
from here on 2026-09-13; `docs.dexscreener.com` no longer hosts it and routes DEX
listing to Discord. Field names were cross-checked against a public adapter for
the same spec (`balancer/balancer-v3-dex-screener-api`). `latest-block` is the last
*fully indexed* block; amounts are decimalized strings; `priceNative` = asset1 per
asset0; events ordered by block, tx index, log index; `maker` = the signing
account. Swaps only: join/exit amounts and reserves are not in any Latch log, so
they are omitted rather than approximated. **Verify against the spec DEX Screener
supplies before submitting.**

---

## 6. Keys and tiers

| | Anonymous | API key |
|---|---|---|
| Identity | client IP (`TRUST_PROXY` must name the proxy) | `X-API-Key` or `Authorization: Bearer` (query string refused) |
| Rate limit | `ANON_RATE_LIMIT_PER_MINUTE` (60) per IP | per key (`rateLimitPerMinute`, default 600) |
| Quota | none | per key `monthlyQuota` (default 1,000,000), UTC month |
| Scopes | `public:read`, `dexscreener:read` | as minted |

- **Key format** `latchk_<12 base32 prefix>_<256-bit secret>`. Stored as
  `HMAC-SHA256(API_KEY_PEPPER, key)`; the pepper is not in the database. Revocable
  (`status`, `revokedAt`, `revokedReason`), optional expiry. A presented key that
  does not resolve is a 401, never a silent downgrade to anonymous.
- **Rate limiting** is a sliding-window counter (two buckets, Lua-atomic in Redis).
  If Redis is down it falls back to an in-process limiter rather than removing
  the limit. Headers: `RateLimit-Limit/Remaining/Reset`, `Retry-After`, `X-Quota-*`.
- **Usage** is counted in Redis (seeded from Postgres so a Redis restart cannot reset
  a month) and flushed to `api_usage_monthly` every minute with SET, not increment.
- **Operator CLI, or the admin panel's API keys page** (`admin` role only: a Safe
  owner, CSRF-checked, audit-logged with the prefix, never the secret; the secret is
  returned once in the mint response and never again). The CLI remains:

```bash
npm run admin -- accounts:create --name "Acme" --plan pro
npm run admin -- keys:create --account <accountId> --name prod --scopes public:read,dexscreener:read --rpm 1200 --quota 5000000
npm run admin -- keys:list
npm run admin -- keys:revoke --id <keyId> --reason "rotated"
npm run admin -- usage:show --period 2026-09
# in the container: docker compose -p latch -f docker-compose.yml run --rm api node dist/cli/admin.js keys:list
```

  A minted key is printed once to stdout and never stored or logged.
- **Billing is out of scope.** `api_accounts.billingProvider/billingCustomerId`
  (unique together) and `plan` are where a billing system attaches; usage rows are
  per key per month.

---

## 7. Admin panel foundation — `/v1/admin` (off unless `ADMIN_ENABLED=true`)

- **Sign-in: SIWE (EIP-4361).** `POST /auth/nonce` issues a single-use nonce (5 min).
  `POST /auth/verify {message, signature}` checks domain (`ADMIN_SIWE_DOMAIN`),
  chain id, URI origin (`ADMIN_ORIGINS`), time bounds, consumes the nonce
  atomically, and verifies the signature (EOA, then ERC-1271 via RPC).
- **Roles from chain, re-checked every `ADMIN_ROLE_RECHECK_SECONDS`:** `admin` =
  owner of Safe `0x715a…3432` (`getOwners`); `curator` = `CURATOR_ROLE` on the SDK
  `LatchRegistry`; `viewer` = `ADMIN_VIEWER_ALLOWLIST`. No role → no session.
  Losing a role revokes the session (audited). A failed role read refuses the
  request rather than trusting a stale grant.
- **Session:** 256-bit token only in a `__Host-latch_admin` cookie (HttpOnly,
  Secure, SameSite=Strict, no Domain); the DB stores its sha256. **CSRF:** Origin
  allowlist on every non-GET, plus `X-CSRF-Token` (sha256 stored, rotated on each
  `GET /auth/session`).
- **`audit_log`** row on every mutation, sign-in, sign-out, denial and role change.
- **Never a key, never a transaction.** On-chain actions are returned as Safe
  payloads (`src/admin/safeTx.ts`: CALL only, no nonce baked in, warnings, e.g.
  `prepareCollectProtocolFees` warns if the recipient is not the Safe).
- Responses are `Cache-Control: no-store`, rate limited per IP, CORS exact-origin
  with credentials. Every route below names its role in `src/http/adminRoutes.ts`;
  `test/adminRoutes.test.ts` asserts 401 / 403 / CSRF / audit for every entry.

### 7a. Routes (`/v1/admin`)

| Method | Path | Role | What it does |
|---|---|---|---|
| POST | `auth/nonce`, `auth/verify` | none | SIWE sign-in; the response lists each role with its reason (`Safe owner`, `Registry curator`, `Viewer allowlist`) and the read it came from |
| GET | `auth/session` · POST `auth/logout` | session | session + fresh CSRF token · sign-out |
| GET | `overview` | viewer | indexer lag, alert counts by severity + top alerts, revenue headlines in token units, queue/key counts |
| GET | `alerts` | viewer | every alert (`src/admin/alerts.ts`, pure rules over worker reads, each with provenance) |
| GET | `revenue` | viewer | ledger (filters: `token`, `source`, `window`/`from`/`to`, paging), totals by source incl. `not-deployed` lines (never zero), protocol fees charged / collected / accrued, optional oracle USD on current balances only |
| GET | `revenue/export.csv` | viewer | same filters as CSV (formula-injection safe, ≤50,000 rows, audited as `revenue.export`) |
| GET | `protocol` | viewer | pools, swaps, volume and fees by input token, kit launches, registry listings with risk class, Vault app registrations |
| GET | `governance/ownership` | viewer | expected tier vs `owner()`/`pendingOwner()` (pending read on the owner wrappers, not the pool managers), guardians, treasury, `hasRole` checks, governance alerts |
| GET | `governance/timelock` | viewer | operations decoded from `CallScheduled`/`CallSalt`/`CallExecuted`/`Cancelled`, status PENDING/READY/EXECUTED/CANCELLED (cancelled has no ready time), do-not-queue flags, the custody-handover operations |
| GET | `governance/roles` | viewer | PROPOSER/EXECUTOR/CANCELLER per timelock, registry roles, pausable-role holders, replayed from logs |
| GET | `safety` | viewer | RevShare pending configs (both shapes, contract clock), ops balances vs gas-denominated thresholds, feed staleness, stock-token `tokenPaused`/`uiMultiplier` and changes |
| GET | `safe/context` | viewer | Safe address, Safe app link, contract addresses |
| POST | `timelock/execute` | viewer | `execute(target, value, payload, predecessor, salt)` for a READY queued single-call operation, salt from `CallSalt`, refused unless it re-hashes to the id; `isOperationReady` + `eth_call` result (audited) |
| POST | `safe/fee-controller/collect` · `…/sweep` | admin | Safe payloads for `LatchProtocolFeeControllerV2`, simulated from the Safe (audited) |
| POST | `registry/listing` | curator | `setListing(hook, Malicious|Active, reason)` as a DIRECT call from the curator's key, simulated from it (audited) |
| GET | `moderation/listings`, `…/:id`, `…/:id/icon` | curator | queue (no contact), detail (with private contact), processed icon |
| POST | `moderation/listings/:id/approve` · `reject` · `request-changes` | curator | review with reason; conditional update so two reviewers cannot double-apply (audited) |
| GET/POST | `keys/accounts` | admin | list / create API accounts (audited) |
| GET | `keys` | admin | keys (prefix only) with usage by month |
| POST | `keys` · `keys/:id/revoke` | admin | mint (secret shown once) · revoke with reason, drops the Redis key cache (audited) |
| GET | `audit` | admin | audit log, filters `actor`, `action` prefix, `targetType`, `from`/`to` |

**There is no schedule builder for the custody handover.** CLAUDE.md "VERIFIED LIVE
STATE": three `acceptOwnership()` operations are already queued on the custody
timelock (block 61,325,176, ready 2026-09-14 18:40:43 UTC). A new schedule would
duplicate them. The ownership alert stays HIGH until `owner()` reads the timelock.

### 7b. Public listings (`/v1/listings`)

| Method | Path | What it does |
|---|---|---|
| POST | `/v1/listings` | ecosystem submission; **404 unless `LISTING_SUBMISSIONS_ENABLED=true`**. Field limits mirror `apps/web` `LISTING_LIMITS` (tested against the file), https-only URLs, per-IP `LISTING_SUBMIT_PER_HOUR` (checked before the body is parsed), optional Turnstile (fails closed), 400 KB body, icon PNG ≤256 KB / SVG ≤64 KB. Contact stored privately; the raw IP is not stored (HMAC). |
| GET | `/v1/listings` | APPROVED listings only, explicit public field allowlist |
| GET | `/v1/listings/:id/icon` | the processed icon of an approved listing, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, `nosniff` |

Icons (`src/admin/icons.ts`): the uploaded bytes are never stored or served. PNG is
CRC-checked, IHDR-validated, IDAT inflated under a hard cap and required to match the
header's size, then rebuilt from critical chunks (text/EXIF/APNG/post-IEND data
dropped). SVG is parsed against an element/attribute allowlist and **rejected** on
script, foreignObject, style, image, animation, event handlers, external or `data:`
references, DOCTYPE/ENTITY, CDATA and PIs; a passing file is re-serialised from the
parse tree.

### 7c. The operator console (`apps/admin`)

Vite + React, served by this process at `/admin` (same origin as `/v1/admin`) when
`ADMIN_ENABLED=true` and `ADMIN_UI_DIR` holds a build; strict CSP (`script-src 'self'`,
`connect-src 'self'`, `frame-ancestors 'none'`), `Referrer-Policy: same-origin` (not
`no-referrer`, which would send `Origin: null` on POST and fail the Origin check). It is
not a GitHub Pages site. The fixture mock server for UI testing lives in
`apps/admin/test/mock-server` and is never bundled.

### 7d. Ops-balance thresholds

`config/chains/<id>.json` `opsAccounts[].gasBudget` states gas units per action,
critical and warning action counts, and a rationale the schema requires. The worker
multiplies by the live `eth_gasPrice` (config reference price on failure). At the
recorded 1,183,834,050,000 wei and 78,334,000 wei/gas the canceller affords zero
cancels: CRITICAL. The gas units are estimates by inspection; replace them with a
measured `eth_estimateGas` + L1 component when one is taken.

---

## 8. Abuse and safety

- GET/HEAD only on `/v1`; request bodies refused (admin POST: 16 KB JSON). URL ≤ 2,048 chars.
- Handler deadline `REQUEST_TIMEOUT_MS` (10 s) → 503; server header/request/keep-alive timeouts.
- Pagination ≤ 200; offsets ≤ 100,000; candle and DEX Screener range caps; 20,000 events per adapter call.
- **No endpoint reads a chain.** Routes → `ReadService` → Postgres/Redis. Only the
  worker (and admin sign-in role checks) use RPC.
- Public CORS `*` without credentials; admin CORS exact origins with credentials.
- Logs: path only (no query string, no headers), caller shown as `key:<prefix>`;
  redaction for authorization, cookie, `x-api-key`, CSRF, `set-cookie`; RPC by host;
  Prisma query logging off; internal error messages never returned.
- `TRUST_PROXY=true` is refused at boot.

---

## 9. Running and testing locally

```bash
cp .env.example .env
docker compose -p latch-api-dev -f compose.dev.yml up -d   # Postgres :55432, Redis :56379, loopback
npm install
npm run db:deploy
npm run admin -- index:once --chain 4663      # one read-only pass + snapshots
npm run admin -- governance:once --chain 4663
npm run admin -- feeds:once --chain 4663
npm run dev            # API on :4000
npm run dev:worker     # scheduled indexing
```

| Command | |
|---|---|
| `npm test` | Unit + HTTP tests. No database, Redis or chain needed (in-memory stores, stubbed Prisma). |
| `TEST_DATABASE_URL=… npx prisma migrate deploy && TEST_DATABASE_URL=… npm test` | Adds the Postgres integration tests (idempotent replay, reorg repair, checkpoint guard, exact integers). Skipped without the variable, so CI stays green. |
| `npm run typecheck` · `npm run build` | |

---

## 10. Deploying on the shared VPS

**Run by the lead, with the owner's approval.** The host runs other projects'
production stacks; `peddles-caddy-1` owns :80/:443. Touch only project `latch`,
always `-p latch -f docker-compose.yml`, never `--remove-orphans`, never a bare
`down` (the keeper is in the same project from another file).

```bash
ssh -o ConnectTimeout=120 ubuntu@<host>

# 0. Prerequisite: latch_net exists (created by the keeper stack). Do NOT create it by hand
#    if the keeper will run later — compose refuses a network without its labels.
docker network inspect latch_net >/dev/null || { echo "bring up ~/latch/keeper first"; exit 1; }

# 1. Code: a checkout under ~/latch (only apps/api and packages/sdk are used by the build).
mkdir -p ~/latch && cd ~/latch
git clone --filter=blob:none --sparse <repo-url> repo && cd repo
git sparse-checkout set apps/api packages/sdk && git checkout <commit>

# 2. Secrets: .env beside the compose file, hex-only values, never committed.
cd ~/latch/repo/apps/api
umask 077
{ echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
  echo "REDIS_PASSWORD=$(openssl rand -hex 32)"
  echo "API_KEY_PEPPER=$(openssl rand -hex 32)"
  echo "TRUST_PROXY=false"
  echo "INDEX_CHAIN_IDS=4663"; } > .env
chmod 600 .env        # do not cat it

# 3. Build and start. Memory: one build at a time.
export COMPOSE_IGNORE_ORPHANS=1
docker compose -p latch -f docker-compose.yml build
docker compose -p latch -f docker-compose.yml up -d postgres redis
docker compose -p latch -f docker-compose.yml up migrate           # exits 0 when applied
docker compose -p latch -f docker-compose.yml up -d api indexer

# 4. Verify — loopback only.
curl -s 127.0.0.1:8093/health/ready
docker compose -p latch -f docker-compose.yml logs --tail 50 indexer
curl -s 127.0.0.1:8093/v1/chains/4663/health
docker ps --format '{{.Names}}' | grep '^latch-'     # latch-keeper still there

# 5. First customer key (printed once).
docker compose -p latch -f docker-compose.yml run --rm api node dist/cli/admin.js accounts:create --name "<name>"
docker compose -p latch -f docker-compose.yml run --rm api node dist/cli/admin.js keys:create --account <id> --name prod

# 6. Admin panel (optional; owner decision). The console is built into the image at
#    /repo/apps/api/admin-ui (compose sets ADMIN_UI_DIR). Append to .env, then recreate api:
{ echo "ADMIN_ENABLED=true"
  echo "ADMIN_ORIGINS=https://<admin-host>"          # exact origin the browser shows
  echo "ADMIN_SIWE_DOMAIN=<admin-host>"
  echo "ADMIN_VIEWER_ALLOWLIST="                      # optional read-only addresses
  echo "ADMIN_SIMULATION_ENABLED=true"
  echo "LISTING_SUBMISSIONS_ENABLED=false"            # true only when moderation is staffed
  echo "TURNSTILE_ENABLED=false"; } >> .env
docker compose -p latch -f docker-compose.yml build api
docker compose -p latch -f docker-compose.yml up migrate           # applies 20260914000000_admin_panel
docker compose -p latch -f docker-compose.yml up -d api indexer
curl -sI 127.0.0.1:8093/admin/ | grep -i content-security-policy
curl -s 127.0.0.1:8093/v1/admin/auth/session                        # 401 = enabled, 404 = disabled
#    The migration's new watched events (timelock RoleGranted/RoleRevoked, PausableRole*)
#    change the address-set hash: the first indexer pass re-reads history from
#    deployedAtBlock by design. Watch `logs indexer` until the checkpoint is back at head.

# Stop / update: named services only.
docker compose -p latch -f docker-compose.yml stop api indexer
```

**Public exposure needs the owner.** The API listens on `127.0.0.1:8093`; a Caddy
running in a container cannot reach the host's loopback. Two options, both an edit
to the shared Caddy stack, so hand them to the owner rather than applying them:

- connect Caddy to `latch_net` (`docker network connect latch_net peddles-caddy-1`) and
  route `reverse_proxy latch-api:4000`, then set `TRUST_PROXY` to `latch_net`'s subnet
  (`docker network inspect latch_net -f '{{(index .IPAM.Config 0).Subnet}}'`); or
- bind the API to the Docker bridge gateway instead of loopback (changes the port
  rule in CLAUDE.md; not recommended).

Caddy block for the first option (the owner adds it to the shared Caddyfile):

```
api.latch.guru {
    encode zstd gzip
    reverse_proxy latch-api:4000
}
```

The admin console needs the same origin for `/admin` and `/v1/admin` (cookie
`SameSite=Strict`, Origin check). Serving it from the API host needs no extra block;
a separate admin host would be (owner applies; restrict by IP if the Safe owners
have stable addresses):

```
admin.latch.guru {
    encode zstd gzip
    @admin path /admin /admin/* /v1/admin/*
    handle @admin {
        reverse_proxy latch-api:4000
    }
    respond 404
}
```

`TRUST_PROXY` must name the proxy's subnet once Caddy fronts it, or the per-IP admin
and submission limits see every request as coming from Caddy.

---

## 11. Known limits and open questions

- Tier pricing (anonymous and key limits, quotas) is config, not decided.
- Domain for the API and admin UI (`latch.guru` is recorded as provisional).
- Where DEX Screener submission happens (their docs route it to Discord) and the
  authoritative adapter spec to check the endpoints against.
- `config/chains/4663.json` ops thresholds are gas budgets with written rationales
  (§7d); the gas units are estimates, not measurements.
- `tokenPaused()` is the name used by the launchpad's `PausableStockToken` fixture; it
  has not been read against the live Stock implementation.
- `uiMultiplier` semantics assumed `shares = raw × uiMultiplier / 1e18` from the
  token's own naming and the 2026-09-13 reads; confirm against `Stock.sol`
  (Sourcify) before USD is shown to users. `newUIMultiplier`/`effectiveAt`
  transitions are not yet handled.
- Bin `Mint`/`Burn` amounts stay packed (layout unverified); Bin swap sign is
  assumed to match CL (no Bin swap exists on chain to verify).
- CL liquidity reported is active liquidity from `getLiquidity`, not TVL; the Vault
  is a singleton, so per-pool reserves are not in any log.
- `LaunchpadKit` event ABI is the SDK's; no kit launch exists on 4663 yet to verify
  the deployed kit emits that exact signature.
