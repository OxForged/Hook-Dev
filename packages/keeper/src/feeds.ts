#!/usr/bin/env node
/* ============================================================================
   latch-feed-watch — a READ-ONLY Chainlink staleness logger.

   Polls `latestRoundData()` on a configured list of aggregator proxies every N
   minutes and appends one JSON line per feed per tick. It exists to MEASURE
   how stale equity feeds get out of hours (weekends, holidays, quiet sessions)
   before anyone picks a `heartbeat` or a `maxPriceAge` for a pool that halts on
   staleness — so those numbers come from a log, not from a docs page.

   Read-only by construction, not by flag:
     * it never reads a private key and has no code path that could sign;
     * it issues only `eth_chainId`, `eth_getBlockByNumber` and `eth_call`;
     * the ABI below is four view functions and nothing else.

   A row is written for every feed on every tick, INCLUDING failures, so a gap
   in the log always means "the process was not running", never "the read
   failed quietly".
   ============================================================================ */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createPublicClient, fallback, http, isAddress, zeroAddress, type Address } from 'viem'

const AGGREGATOR_ABI = [
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'aggregator', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const

export interface FeedSpec {
  readonly label: string
  readonly proxy: Address
  /** The feed's PUBLISHED heartbeat, in seconds. A row is flagged when staleness exceeds it. */
  readonly heartbeatSeconds: number
  /**
   * Exact `description()` the proxy must return. Checked once at startup.
   * This is the decoy guard: an address that answers the AggregatorV3 shape but
   * is not the feed you meant fails here instead of logging plausible numbers.
   */
  readonly expectedDescription?: string
}

export interface FeedWatchConfig {
  readonly chainId: number
  readonly rpcUrls: readonly string[]
  readonly intervalMinutes: number
  readonly out: string
  readonly feeds: readonly FeedSpec[]
  readonly notes?: string
}

/** One JSONL line. Field names are the contract. Do not rename them once logs exist. */
export interface StalenessRow {
  /** Local wall clock at the read, ISO-8601 UTC. */
  readonly ts: string
  readonly chainId: number
  readonly block: string
  /** `block.timestamp` of the block every feed in this tick was read at. */
  readonly blockTimestamp: number
  readonly feed: string
  readonly proxy: Address
  readonly roundId: string | null
  /** Raw integer answer, as a string (int256 does not fit a JSON number). */
  readonly answer: string | null
  readonly decimals: number | null
  readonly updatedAt: number | null
  /** `blockTimestamp - updatedAt`. Chain time, which is what the adapter compares against. */
  readonly stalenessSeconds: number | null
  readonly heartbeatSeconds: number
  /** `stalenessSeconds > heartbeatSeconds`. Null when the read failed. */
  readonly heartbeatViolation: boolean | null
  /** Present and true only for rows produced by `--at-block`, i.e. read from a past block, not polled live. */
  readonly historical?: true
  readonly error?: string
}

/** Pure, so the flag logic is testable without a chain. Mirrors the adapter's `updated + heartbeat < now`. */
export function stalenessOf(blockTimestamp: number, updatedAt: number, heartbeatSeconds: number): {
  stalenessSeconds: number
  heartbeatViolation: boolean
} {
  const stalenessSeconds = blockTimestamp - updatedAt
  return { stalenessSeconds, heartbeatViolation: updatedAt + heartbeatSeconds < blockTimestamp }
}

export function loadFeedWatchConfig(path: string): FeedWatchConfig {
  const p = resolve(path)
  if (!existsSync(p)) throw new Error(`feed-watch config not found: ${p}`)
  const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>

  const chainId = Number(raw['chainId'])
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('feed-watch config: chainId must be a positive integer')

  const rpcUrls = raw['rpcUrls']
  if (!Array.isArray(rpcUrls) || rpcUrls.length === 0) throw new Error('feed-watch config: rpcUrls must be a non-empty array')
  for (const u of rpcUrls) {
    if (typeof u !== 'string' || !u.startsWith('https://')) {
      throw new Error(`feed-watch config: rpcUrls must all be https, got: ${String(u)}`)
    }
  }

  const intervalMinutes = Number(raw['intervalMinutes'] ?? 15)
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
    throw new Error('feed-watch config: intervalMinutes must be at least 1')
  }

  const out = typeof raw['out'] === 'string' && raw['out'].length > 0 ? raw['out'] : `logs/feed-staleness.${chainId}.jsonl`

  const rawFeeds = raw['feeds']
  if (!Array.isArray(rawFeeds) || rawFeeds.length === 0) throw new Error('feed-watch config: feeds must be a non-empty array')
  const feeds: FeedSpec[] = rawFeeds.map((f: Record<string, unknown>, i) => {
    const where = `feeds[${i}]`
    const proxy = f['proxy']
    if (typeof proxy !== 'string' || !isAddress(proxy) || proxy.toLowerCase() === zeroAddress) {
      throw new Error(`${where}.proxy: not a non-zero address: ${String(proxy)}`)
    }
    const heartbeatSeconds = Number(f['heartbeatSeconds'])
    if (!Number.isInteger(heartbeatSeconds) || heartbeatSeconds <= 0) {
      throw new Error(`${where}.heartbeatSeconds: must be a positive integer (the feed's published heartbeat)`)
    }
    const expected = f['expectedDescription']
    return {
      label: typeof f['label'] === 'string' ? f['label'] : where,
      proxy,
      heartbeatSeconds,
      ...(typeof expected === 'string' ? { expectedDescription: expected } : {}),
    }
  })

  return {
    chainId,
    rpcUrls: rpcUrls as string[],
    intervalMinutes,
    out,
    feeds,
    ...(typeof raw['notes'] === 'string' ? { notes: raw['notes'] } : {}),
  }
}

function parseArgs(argv: readonly string[]): {
  config: string
  once: boolean
  intervalMinutes?: number
  out?: string
  atBlock?: bigint
} {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const iv = get('--interval-minutes')
  const out = get('--out')
  const atBlock = get('--at-block')
  if (atBlock !== undefined && !/^[0-9]+$/.test(atBlock)) throw new Error('--at-block must be a decimal block number')
  return {
    config: get('--config') ?? 'feeds.config.robinhood.json',
    once: argv.includes('--once'),
    ...(iv === undefined ? {} : { intervalMinutes: Number(iv) }),
    ...(out === undefined ? {} : { out }),
    ...(atBlock === undefined ? {} : { atBlock: BigInt(atBlock) }),
  }
}

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // viem errors are multi-line; the first line is the useful one and keeps the JSONL one line.
  return (msg.split('\n')[0] ?? msg).slice(0, 300)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const cfg = loadFeedWatchConfig(args.config)
  const intervalMinutes = args.intervalMinutes ?? cfg.intervalMinutes
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) throw new Error('--interval-minutes must be at least 1')
  const out = resolve(args.out ?? cfg.out)

  const client = createPublicClient({
    transport: fallback(cfg.rpcUrls.map((u) => http(u, { timeout: 20_000, retryCount: 3, retryDelay: 2_000, batch: { wait: 25 } })), {
      rank: false,
    }),
  })

  const rpcChainId = await client.getChainId()
  if (rpcChainId !== cfg.chainId) {
    throw new Error(`config says chainId ${cfg.chainId} but the RPC answers chain ${rpcChainId}. Refusing to start.`)
  }

  /* ---- startup verification: every proxy is the feed it claims to be ---------
     Three checks, because a decoy that answers `latestRoundData` is exactly what
     this chain has already shown us (a "SequencerUptimeRouter" hardcoded to UP).
       1. `description()` matches the configured string exactly, when given;
       2. `aggregator()` answers with a contract — i.e. this is a proxy in front
          of a real aggregator, not a contract implementing the read shape;
       3. `decimals()` is read once and logged with every row. */
  const decimals = new Map<Address, number>()
  for (const f of cfg.feeds) {
    const [description, dec, aggregator] = await Promise.all([
      client.readContract({ address: f.proxy, abi: AGGREGATOR_ABI, functionName: 'description' }),
      client.readContract({ address: f.proxy, abi: AGGREGATOR_ABI, functionName: 'decimals' }),
      client.readContract({ address: f.proxy, abi: AGGREGATOR_ABI, functionName: 'aggregator' }),
    ])
    if (f.expectedDescription !== undefined && description !== f.expectedDescription) {
      throw new Error(`${f.label}: description() is "${description}", config expects "${f.expectedDescription}". Refusing to log a feed that is not the one named.`)
    }
    const code = await client.getCode({ address: aggregator })
    if (aggregator.toLowerCase() === zeroAddress || code === undefined || code === '0x') {
      throw new Error(`${f.label}: aggregator() is ${aggregator}, which has no code. Not an aggregator proxy.`)
    }
    decimals.set(f.proxy, dec)
    console.log(`feed ${f.label} · ${f.proxy} · "${description}" · decimals ${dec} · aggregator ${aggregator} · heartbeat ${f.heartbeatSeconds}s`)
  }

  mkdirSync(dirname(out), { recursive: true })
  console.log(`latch-feed-watch · chain ${cfg.chainId} · ${cfg.feeds.length} feed(s) · every ${intervalMinutes} min · appending to ${out}`)
  console.log('READ ONLY: no key is read, nothing is signed.')
  if (cfg.notes) console.log(`notes: ${cfg.notes}`)

  // `--at-block N` reads ONE past block and exits: backfilling a weekend that was not being polled,
  // or proving the violation flag. Needs an archive-capable RPC; the canonical Robinhood endpoint
  // prunes state within hours and answers "metadata is not found".
  const tick = async (): Promise<void> => {
    const block = args.atBlock === undefined ? await client.getBlock() : await client.getBlock({ blockNumber: args.atBlock })
    const blockTimestamp = Number(block.timestamp)
    const lines: string[] = []
    let violations = 0
    // Every feed is read AT THE SAME BLOCK, so rows in a tick are comparable.
    const results = await Promise.allSettled(
      cfg.feeds.map((f) =>
        client.readContract({ address: f.proxy, abi: AGGREGATOR_ABI, functionName: 'latestRoundData', blockNumber: block.number }),
      ),
    )
    const ts = new Date().toISOString()
    cfg.feeds.forEach((f, i) => {
      const r = results[i]
      const base = {
        ts,
        chainId: cfg.chainId,
        block: block.number.toString(),
        blockTimestamp,
        feed: f.label,
        proxy: f.proxy,
        decimals: decimals.get(f.proxy) ?? null,
        heartbeatSeconds: f.heartbeatSeconds,
        ...(args.atBlock === undefined ? {} : { historical: true as const }),
      }
      let row: StalenessRow
      if (r === undefined || r.status === 'rejected') {
        row = {
          ...base,
          roundId: null,
          answer: null,
          updatedAt: null,
          stalenessSeconds: null,
          heartbeatViolation: null,
          error: r === undefined ? 'no result' : errText(r.reason),
        }
      } else {
        const [roundId, answer, , updatedAtBig] = r.value
        const updatedAt = Number(updatedAtBig)
        const s = stalenessOf(blockTimestamp, updatedAt, f.heartbeatSeconds)
        if (s.heartbeatViolation) violations++
        row = {
          ...base,
          roundId: roundId.toString(),
          answer: answer.toString(),
          updatedAt,
          stalenessSeconds: s.stalenessSeconds,
          heartbeatViolation: s.heartbeatViolation,
        }
      }
      lines.push(JSON.stringify(row))
    })
    // One append per tick: a crash mid-tick leaves whole lines, never half of one.
    appendFileSync(out, lines.join('\n') + '\n', 'utf8')
    console.log(`[${ts}] block ${block.number} · ${lines.length} row(s) · ${violations} heartbeat violation(s)`)
  }

  await tick()
  if (args.once || args.atBlock !== undefined) return
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMinutes * 60_000))
    try {
      await tick()
    } catch (e) {
      // Never exit on a transient RPC failure: a weekend log with a hole in it is
      // worth less than one that recorded the failure and carried on.
      console.error(`[${new Date().toISOString()}] tick failed: ${errText(e)}`)
    }
  }
}

// Run only as the entry point, so `stalenessOf` / `loadFeedWatchConfig` can be imported by tests.
const entry = process.argv[1] ?? ''
if (entry.endsWith('feeds.js') || entry.endsWith('latch-feed-watch')) {
  main().catch((e: unknown) => {
    console.error(errText(e))
    process.exit(1)
  })
}
