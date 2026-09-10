# @latchprotocol/api

Analytics and hook-registry API for **Latch Protocol** — a hooks platform and AMM
for EVM chains where Uniswap v4 is not deployed.

Node + Express + TypeScript (strict) · PostgreSQL via Prisma · Redis · BullMQ.

---

## The one thing to know first

**No Latch Protocol contract is deployed on any chain.** There is no RPC endpoint
to read and no indexer to query.

So the chain-reading layer is an interface with two implementations, and the
default is a fixture provider. Everything this API serves today is synthetic and
labelled as such:

- every ingested row carries `dataSource: FIXTURE` in the database;
- every response carries `meta.dataSource` and an `X-LatchProtocol-Data-Source`
  header;
- fixture-derived payloads carry an explicit `meta.disclaimer`;
- every fabricated address begins with the marker nibbles `0xf1c7`, and the
  fixture chain is id `31337`, named "Fixture Devnet (not a real network)".

Going live is configuration, not code. See [the mock/live boundary](#the-mocklive-boundary).

---

## Running it locally

```bash
cp .env.example .env          # defaults work as-is
docker compose up -d          # Postgres + Redis
npm install
npm run db:push               # create the schema
npm run db:seed               # chains, token metadata, hook registry
npm run dev                   # API on :4000, ingestion worker in-process
```

The in-process worker backfills the fixture timeline within a few seconds of
startup. Then:

```bash
curl localhost:4000/api/v1/stats/overview?chainId=31337
curl localhost:4000/api/v1/pools?chainId=31337
curl localhost:4000/health/ingestion
```

If ports 5432 or 6379 are already taken on your machine:

```bash
POSTGRES_PORT=5442 REDIS_PORT=6389 docker compose up -d
# then set the matching ports in DATABASE_URL / REDIS_URL in .env
```

To run the API and the worker as separate processes (what you want once a
backfill is large enough to compete with request handling), set
`INGEST_ENABLED=false` and run `npm run start:worker` alongside `npm run dev`.

### Other commands

| Command | Does |
| --- | --- |
| `npm run build` | `prisma generate` + `tsc` → `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit suite. Needs no database or Redis. |
| `npm run db:migrate` | Create a migration instead of pushing |
| `npm run db:studio` | Prisma Studio |

---

## Layout

```
src/
  app.ts                  Express app factory (takes a PrismaClient, for tests)
  index.ts                Process entry: HTTP server + optional in-process worker

  routes/                 HTTP surface. Validation + response shaping only.
  services/               Business logic, caching, DTOs.
  repositories/           All Prisma access. Nothing else touches the database.

  chain/                  ─── everything that knows about the blockchain ───
    contracts.ts          Contract roles, the fee-controller ABI, the collision note
    decode.ts             log -> typed domain event
    provider/
      types.ts            THE MOCK/LIVE BOUNDARY (ChainLogProvider)
      fixture.ts          Reads src/chain/fixtures. The default.
      rpc.ts              Reads eth_getLogs over viem. Complete; nothing to point at.
      index.ts            Provider selection policy
    fixtures/devnet.ts    The synthetic timeline. Every value here is invented.

  jobs/                   BullMQ queue, worker, scheduling
  middleware/             Request context, validation, error handling
  lib/                    Errors, ids, pagination, serialisation, response envelope
  cache/                  Redis connections + read-through cache
  db/                     Prisma client
```

Layering rule: **routes → services → repositories → Prisma.** A route never
imports Prisma; a repository never formats a response.

---

## The mock/live boundary

It is one file: [`src/chain/provider/types.ts`](src/chain/provider/types.ts).

```ts
export interface ChainLogProvider {
  readonly kind: "fixture" | "rpc";
  readonly chainId: number;
  getLatestBlockNumber(): Promise<bigint>;
  getLogs(query: LogQuery): Promise<RawLog[]>;
  describe(): string;
}
```

Everything above it — the ingestion service, the decoders, the repositories, the
REST layer — is written against that interface and cannot tell which
implementation it is talking to. The fixture path is not a parallel code path; it
is the same code path with a different source of bytes. Fixture logs are
ABI-encoded for real using the SDK's generated event ABIs, so the decoder under
test is the decoder that will run against live logs.

**Selection policy** (`CHAIN_PROVIDER`):

| Value | Behaviour |
| --- | --- |
| `fixture` | Always fixtures. **The default**, because nothing is deployed. |
| `rpc` | Always RPC. Throws loudly if a chain has no endpoint or no addresses. |
| `auto` | RPC for chains with *both* an endpoint and recorded contract addresses; fixtures for the rest. |

**To go live**, once contracts exist:

1. Record the Vault and pool-manager addresses for the chain (ingestion
   discovers them itself from `AppRegistered` / `Initialize` once it can see the
   Vault, so in practice: set the chain's `startBlock` and enable it).
2. Set `RPC_URL_<chainId>`.
3. Set `CHAIN_PROVIDER=auto`.

No code above `ChainLogProvider` changes. Rows then arrive stamped
`dataSource: ONCHAIN`, and every response label follows automatically.

`GET /health/ingestion` reports which provider each chain resolved to, which
contracts are watched, where each cursor sits, and the last ten ingestion runs.

---

## Ingestion pipeline

```
resolve contracts → pick provider → read cursor
  → per block window:  getLogs → decode → apply (one transaction) → advance cursor
```

Two BullMQ job types, both running the same pass and differing only in how the
window is chosen — so the "catch up" and "repair" paths cannot drift apart:

- **`poll`** — repeatable per chain, from the cursor to `head - INGEST_CONFIRMATIONS`.
- **`backfill`** — one-off over an explicit range, via `POST /api/v1/admin/ingest`.

**Idempotence.** Ingestion re-reads ranges after a crash, a reorg, or an operator
backfill. Every write is an upsert or a `createMany({ skipDuplicates: true })`
keyed on a deterministic id, and cumulative counters are incremented *only* for
rows that were genuinely new. Replaying the whole fixture range is a verified
no-op: 291 logs decoded, 0 rows written, every counter byte-identical.

**Cursors** advance per block window, so a crashed backfill resumes from the last
completed window rather than from the start.

### topic0 does not identify an event

Across `Vault`, `CLPoolManager`, `BinPoolManager` and the shared `ProtocolFees`
base there are **34 event declarations but only 22 distinct signatures**.
`ProtocolFees` is inherited by *both* pool managers, so these are byte-identical
and collide on topic0:

| Signature | Declared by |
| --- | --- |
| `OwnershipTransferred(address,address)` | 4 contracts |
| `Paused(address)` | 3 |
| `Unpaused(address)` | 3 |
| `ProtocolFeeUpdated(bytes32,uint24)` | 3 |
| `ProtocolFeeControllerUpdated(address)` | 3 |
| `DynamicLPFeeUpdated(bytes32,uint24)` | 2 |

A `ProtocolFeeUpdated` log therefore **cannot** be attributed to CL or bin
activity from its topics alone. Consequently:

- decoding is always keyed on **`(chainId, contractAddress, topic0)`** — the
  caller resolves an emitting address to a *role* and passes it in, and a log
  from an unknown address is never decoded;
- the emitting address and topic0 are **persisted on every event row**
  (`contract`, `topic0`), with a `@@index([chainId, contract])`;
- the API exposes the emitter as `emittedBy` on every event DTO.

Verified end to end: the fixture timeline deliberately emits `ProtocolFeeUpdated`
from both managers, and `GET /api/v1/protocol-fee-changes` returns two rows with
an identical `topic0` and different `emittedBy`.

---

## Data model

Prisma schema: [`prisma/schema.prisma`](prisma/schema.prisma).

The event-derived half mirrors [`packages/sdk/schema.graphql`](../../packages/sdk/schema.graphql),
which is the canonical indexer entity model. Deliberate deviations:

- **Everything is scoped by `Chain`.** The subgraph schema assumes one deployment
  per store; this API serves many chains from one database. Ids are
  `${chainId}-${subgraphId}`, so stripping the prefix recovers the subgraph id.
- **No `Transaction` entity.** Tx hash, block number and block timestamp are
  denormalised onto each event row. An analytics API reads events by time and
  pool far more often than "everything in transaction X", and this removes a
  write and a join from the hot ingestion path.
- **`HookRegistryEntry` / `HookRegistryDeployment`** have no subgraph equivalent.
  They are curated marketplace metadata, not chain observations.

Wide on-chain integers (`int128` / `uint128` / `uint160` amounts and prices) do
not fit in a 64-bit `BIGINT` and are `Decimal @db.Decimal(78, 0)` — 78 digits
covers `uint256`, scale 0 keeps them exact. They serialise to JSON as **decimal
strings**, never numbers, because a `uint160` price cannot round-trip through an
IEEE-754 double.

### Entities

| Group | Models |
| --- | --- |
| Topology | `Chain`, `Vault`, `PoolManager` |
| Reference | `Token`, `Hook` |
| Registry | `HookRegistryEntry`, `HookRegistryDeployment` |
| Pools | `Pool` |
| Events | `Swap`, `LiquidityChange`, `Donate`, `ProtocolFeeChange`, `DynamicLpFeeUpdate`, `AppRegistration`, `VaultTokenEvent` |
| Positions | `LiquidityPosition` |
| Bookkeeping | `IngestionCursor`, `IngestionRun` |

`LiquidityChange` unifies CL `ModifyLiquidity` with bin `Mint`/`Burn` into one
entity with nullable per-type columns, following the SDK schema.
`LiquidityPosition` is the aggregated state alongside it.

`ProtocolFeeChange` is the union of seven governance events — the core's
`ProtocolFeeUpdated` and `ProtocolFeeControllerUpdated` plus the fee
controller's `DefaultFeeUpdated`, `PoolFeeUpdated`, `TierFeeUpdated`,
`DynamicFeeUpdated` and `FeesDisabledSet` — discriminated by `source`.

### Bin amounts are kept opaque

`Mint` and `Burn` emit `bytes32[] amounts`, where each word packs an
`(amount0, amount1)` pair under `PackedUint128Math`. **This is not decoded.**
The packing has not been verified against `BinHelper`/`PackedUint128Math`, and a
wrong guess would silently corrupt every bin volume figure. The words are stored
verbatim and surfaced as `bin.packedAmounts` with an explicit
`encoding: "PackedUint128Math bytes32 — not decoded by this API"`.

### Hook permissions

Latch Protocol does **not** encode hook permissions in the hook's address. They
live in the low 16 bits of `poolKey.parameters` and are cross-checked against the
hook's `getHooksRegistrationBitmap()` at `initialize()`. Two consequences the
model reflects:

- one hook address can back pools with **different** bitmaps, so `Hook` carries
  both `registrationBitmap` (what the contract reports) and `observedBitmaps[]`
  (what has actually been seen in pool keys);
- the bitmap is recorded per `Pool`, which is what makes
  `GET /api/v1/stats/permissions` — a histogram of which callbacks pools actually
  register — possible at all.

Bit offsets, encode/decode and dependency validation all come from
`@latchprotocol/sdk`; nothing is re-derived here.

---

## Endpoints

All payloads are `{ data, meta }`. Event feeds use opaque keyset cursors; list
endpoints use `limit`/`offset`.

### Health

| Route | Purpose |
| --- | --- |
| `GET /health/live` | Process is up. No dependency checks. |
| `GET /health/ready` | Postgres + Redis both answer, else 503. |
| `GET /health/ingestion` | Provider per chain, watched contracts, cursors, recent runs. |

### v1

| Route | Notes |
| --- | --- |
| `GET /api/v1` | Self-describing index |
| `GET /api/v1/chains` | Includes `supportsEip1153` / `transientBackend` and the resolved `providerKind` |
| `GET /api/v1/pools` | `chainId`, `poolType`, `hook` (or `none`), `token`, `search`, `hasHook`, `sort`, `direction` |
| `GET /api/v1/pools/:id` | Row id or bare pool id; includes the verbatim pool key so the id can be recomputed |
| `GET /api/v1/pools/:id/swaps` | Keyset paginated |
| `GET /api/v1/pools/:id/liquidity` | Keyset paginated |
| `GET /api/v1/swaps` | `chainId`, `poolId`, `hook`, `sender`, `poolType`, `from`, `to` |
| `GET /api/v1/liquidity-changes` | CL `ModifyLiquidity` + bin `Mint`/`Burn` |
| `GET /api/v1/protocol-fee-changes` | Every row carries `emittedBy` |
| `GET /api/v1/vault-events` | Claim-token `Transfer` / `Approval` / `OperatorSet` |
| `GET /api/v1/hooks` | Hook contracts observed in pool keys |
| `GET /api/v1/hooks/:address` | Includes a decoded permission view per observed bitmap |
| `GET /api/v1/registry` | Marketplace. Filter by `poolType`, `verified`, `auditStatus`, `kind`, `chainId`, `tag`, `search`, and required permission bits (`?bits=6,7,11`) |
| `GET /api/v1/registry/facets` | Tag counts for filter chips |
| `GET /api/v1/registry/:slug` | Listing detail |
| `GET /api/v1/permissions/flags` | Bit table for a pool type |
| `GET /api/v1/permissions/decode` | `?poolType=CL&bitmap=0x08c0` |
| `GET /api/v1/stats/overview` | Totals |
| `GET /api/v1/stats/timeseries` | `interval=hour\|day\|week`, bucketed swaps + volume |
| `GET /api/v1/stats/top-pools` · `top-hooks` | Leaderboards |
| `GET /api/v1/stats/permissions` | Callback-registration histogram per pool type |
| `GET /api/v1/stats/fee-tiers` | Fee-tier distribution |
| `POST /api/v1/admin/ingest` | Trigger a backfill. `sync: true` runs inline. Requires `ADMIN_TOKEN`. |

Admin routes are **disabled** when `ADMIN_TOKEN` is unset, rather than left open.

---

## The hook registry

`GET /api/v1/registry` is the marketplace surface. Every seeded entry is
`kind: EXAMPLE` — written to demonstrate the shape of a listing (permission
bitmap, audit fields, multi-chain deployment join) and describing no real
project, team or deployed contract. Authors are named "Example …" for the same
reason.

Listings link to observed `Hook` rows through `HookRegistryDeployment`, and
ingestion attaches that link automatically the first time an address is seen in a
pool key, so a listing lights up with real pool and swap counts as data arrives.

---

## Caching

Redis is used for a read-through response cache (`src/cache/cache.ts`) on list
and aggregate endpoints. **A cache failure never becomes a request failure** —
every Redis call is wrapped, and an outage is indistinguishable from a miss.

Event feeds are deliberately *not* cached: they are keyset-paginated append-only
reads that already cost one index seek, and caching them makes the freshest data
— the reason anyone opens an explorer — arbitrarily stale.

Two Redis connections are opened, because BullMQ requires
`maxRetriesPerRequest: null` and takes ownership of its connection's blocking
commands; sharing one would stall cache reads behind a blocking pop.

---

## Tests

```bash
npm test
```

Unit suite, no database or Redis required:

- **`test/decode.test.ts`** — the topic0 collision (same topic0 attributed to the
  right pool type via the emitting address; a CL log refuses to decode as bin),
  full fixture-timeline decode, deterministic chain-scoped ids, pool ids matching
  the SDK's `poolKeyToId`, bin amounts staying opaque, swap sign convention, and
  the fixture provider's block-range and ordering semantics.
- **`test/permissions.test.ts`** — pins every bit offset to the Solidity
  constants, and covers dependency validation (`afterSwapReturnsDelta` without
  `afterSwap`), unassigned bits, and the CL/bin naming split at bits 2-5.
- **`test/infrastructure.test.ts`** — diffs the hand-declared fee-controller ABI
  against the compiled artifact, cursor round-tripping, id construction, and the
  response-provenance labelling (including that an unlabelled row fails *closed*
  to `fixture`, never to `onchain`).

There are no database-backed integration tests; the pipeline was instead verified
end to end against real Postgres and Redis (see the idempotence result above).
