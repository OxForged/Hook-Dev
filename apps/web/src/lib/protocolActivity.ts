/* ============================================================================
   Protocol activity for the landing page: volume, fees, creator revenue and
   protocol revenue, per token, read from logs and checked against counters.

   LANDING-SAFE ON PURPOSE. This module imports viem and `./chain` only — no
   wagmi, no RainbowKit, nothing under `routes/dapp/`. The landing chunk must
   not grow a wallet stack to draw a KPI row.

   WHAT EACH FIGURE IS, AND WHERE IT COMES FROM
     volume          Swap logs from BOTH pool managers, INPUT side only: the
                     negative delta. Verified against a real swap on Robinhood
                     (block 60,244,152: amount0 = -1e18 exactly, an exact-input
                     swap of 1e18 base units). The caller's delta, not the
                     pool's, despite the interface's doc comment.
     swap fee        input x the swap's OWN `fee` pips, protocol slice input x
                     its own `protocolFee` — core's formula in CLPool.swap
                     (`(amountIn + feeAmount) * protocolFee / 1e6`). Derived per
                     swap, so a later fee change cannot rewrite history.
     Latch cut       `RevShareTaken` logs, split into LP donation, beneficiary
                     roster ("creators") and distributor ("holders").
     protocol fees   the Swap-log slice above, plus `protocolFeesAccrued` on
                     both managers for what is still uncollected.

   ONLY LATCH'S OWN RevShareHook DEPLOYMENTS ARE SUMMED for the cut: every one
   the address book lists in `revShareHooks`, current and retired (a retired
   hook still hosts pools). A third-party hook can emit an event with the same
   signature and any numbers it likes; counting it would let a stranger write
   our landing page.

   TEST-TOKEN POOLS ARE LEFT OUT. A pool either of whose currencies the address
   book marks `isTestToken` contributes nothing to any figure here — not its
   swaps, not its cut, not its tokens — and is counted only in
   `hiddenTestPools`, so the page can say something was left out. Owner
   decision, 2026-09-14: showcase surfaces show real pools only. The
   completeness check on cut logs (check 1) still runs over EVERY log before
   anything is dropped.

   THE SCAN CHECKS ITSELF. `RevShareHook.totalTaken(poolId, currency)` is a
   lifetime counter incremented by exactly `lpDonated + toBeneficiaries +
   toDistributor` in the same call that emits the log. So the logs must sum to
   the counter, pool by pool; and every `RevShareTaken` must share a
   transaction with a Swap log. Either check failing means the endpoint served
   a short answer, and the whole read REJECTS rather than rendering a total
   that is quietly low. A hook that predates `totalTaken` (Sepolia's) reverts;
   that is reported as "not checkable", never as "checked".

   HOW THE LOGS ARE FETCHED — ONE REQUEST FIRST, WINDOWS SECOND.
   The dapp's windowed scans cost ~250 requests on Robinhood and the public
   endpoint meters them; measured 2026-09-13, `rpc-robinhood.blockmachine.io`
   served 13 sequential 9,000-block windows and then refused 27 in a row. But
   `rpc.mainnet.chain.robinhood.com` answered `eth_getLogs` for 2,300,000
   blocks in ONE request (and sends CORS headers, checked). So each endpoint
   the SDK lists is asked, in order, to serve the WHOLE read at its OWN head —
   the three log queries, then every counter pinned to that same block — and
   the first that completes it wins. Measured end to end against Robinhood:
   2 Swap logs, 2 RevShareTaken logs, both totalTaken checks equal, in 6-15s
   including the refusals from the endpoints listed ahead of it. Only if every one
   refuses does the windowed `scanWindowsMulti` run — and only when the range
   is small enough to finish inside its 25s deadline, because a doomed scan
   spends the per-minute quota the live block poll shares, and would turn a
   healthy BLOCK cell into a false "unreachable".

   Cached for the session per chain. A rejection is dropped from the cache so a
   remount retries rather than replaying the failure.
   ========================================================================== */

import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'

import {
  ACTIVE_CHAIN_ID,
  DEPLOYMENTS,
  client,
  logRpcsFor,
  scanWindowsMulti,
  tradesTestToken,
  type DeployedChainId,
} from './chain'

/* ---------------------------------------------------------------------------
   ABIs — only what is read.
   --------------------------------------------------------------------------- */

const CL_SWAP = parseAbi([
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee, uint16 protocolFee)',
])[0]

const BIN_SWAP = parseAbi([
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint24 activeId, uint24 fee, uint16 protocolFee)',
])[0]

const REV_SHARE_TAKEN = parseAbi([
  'event RevShareTaken(bytes32 indexed poolId, address indexed currency, uint256 lpDonated, uint256 toBeneficiaries, uint256 toDistributor)',
])[0]

const POOL_MANAGER = parseAbi([
  'function poolIdToPoolKey(bytes32 id) view returns (address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters)',
  'function protocolFeesAccrued(address currency) view returns (uint256)',
])

const REV_SHARE_HOOK = parseAbi([
  'function totalTaken(bytes32 poolId, address currency) view returns (uint256)',
])

const ERC20 = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

const ZERO: Address = '0x0000000000000000000000000000000000000000'
const PIPS = 1_000_000n

/* ---------------------------------------------------------------------------
   Budgets
   --------------------------------------------------------------------------- */

/** Per-request timeout for the single-request attempt on one endpoint. */
const SINGLE_REQUEST_TIMEOUT_MS = 10_000

/** The whole read — every endpoint tried, counters read — must settle by this. */
const READ_DEADLINE_MS = 30_000

/**
 * The window span `lib/chain.ts` slices at. Used here ONLY to estimate what the
 * windowed fallback would cost before deciding whether to start it; the real
 * slicing is still `scanWindowsMulti`'s own.
 */
const FALLBACK_WINDOW_SPAN = 9_000n

/**
 * Windows per query the fallback may plan. Three queries share one pool of
 * three, so 30 windows is ~90 requests — about what finishes inside the 25s
 * scan deadline on an endpoint that is merely slow. Past it the scan cannot
 * finish, and starting it would only drain the quota the block poll needs.
 */
const MAX_FALLBACK_WINDOWS = 30n

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

export interface TokenActivity {
  address: Address
  /** From the address book, then `symbol()`; null when neither answers. */
  symbol: string | null
  /** From the address book, then `decimals()`; null means amounts are raw base units. */
  decimals: number | null
  /** Swaps in which this token was the INPUT. */
  swapsIn: number
  /** Sum of input amounts. */
  volumeIn: bigint
  /** LP slice of the swap fee, derived per swap. */
  lpSwapFee: bigint
  /** Protocol slice of the swap fee, derived per swap. */
  protocolSwapFee: bigint
  /** Swaps paying in this token whose own `protocolFee` field was non-zero. */
  protocolFeeSwaps: number
  /** `RevShareTaken.lpDonated`. */
  cutLp: bigint
  /** `RevShareTaken.toBeneficiaries` — the roster, "creators". */
  cutCreators: bigint
  /** `RevShareTaken.toDistributor` — the epoch distributor, "holders". */
  cutHolders: bigint
  /** `protocolFeesAccrued(currency)` on both managers: accrued and NOT yet collected. */
  protocolAccrued: bigint
}

/** What the `totalTaken` cross-check established. A mismatch never reaches here: it rejects. */
export type CutCheck =
  | { k: 'verified'; pairs: number }
  /** At least one hook reverted on `totalTaken` (it predates the counter). */
  | { k: 'unavailable'; pairs: number; verified: number }
  /** Nothing to check: no cut logs and no swapped pool on one of our hooks. */
  | { k: 'none' }

export interface ProtocolActivity {
  chainId: DeployedChainId
  /** First block scanned: the deployment's `deployedAtBlock`. */
  fromBlock: bigint
  /** Last block scanned: the serving endpoint's own head at the time. */
  toBlock: bigint
  method: 'single' | 'windowed'
  swapCount: number
  /** Distinct blocks that carried a swap, ascending. */
  swapBlocks: bigint[]
  /** Distinct pools that swapped, across both managers. */
  poolCount: number
  /** How many of Latch's own RevShareHook deployments were scanned. Zero: none configured. */
  cutHooks: number
  /** Swapped pools left out because they trade an address-book test token. */
  hiddenTestPools: number
  cutCheck: CutCheck
  /** Every token that was an input or a cut currency, ordered by address-book position then address. */
  tokens: TokenActivity[]
}

/* ---------------------------------------------------------------------------
   Plumbing
   --------------------------------------------------------------------------- */

type ActivityLog =
  | {
      k: 'swap'
      manager: 'cl' | 'bin'
      poolId: Hex
      amount0: bigint
      amount1: bigint
      fee: number
      protocolFee: number
      blockNumber: bigint
      txHash: Hex
    }
  | {
      k: 'cut'
      hook: Address
      poolId: Hex
      currency: Address
      lp: bigint
      creators: bigint
      holders: bigint
      blockNumber: bigint
      txHash: Hex
    }

type LogQuery = (c: PublicClient, from: bigint, to: bigint) => Promise<ActivityLog[]>

const reason = (e: unknown): string => {
  if (e instanceof BaseError) return e.shortMessage
  return e instanceof Error ? e.message : String(e)
}

function withDeadline<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(why)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** A contract answered "no" — as opposed to the endpoint failing to answer at all. */
function isRevert(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false
  return (
    e.walk(
      (x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError,
    ) !== null
  )
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return 'endpoint'
  }
}

/** One client per URL, no fallback and no retry: a refusal must fall straight through. */
const endpointClients = new Map<string, PublicClient>()
function endpointClient(url: string): PublicClient {
  const hit = endpointClients.get(url)
  if (hit) return hit
  const made = createPublicClient({
    transport: http(url, { timeout: SINGLE_REQUEST_TIMEOUT_MS, retryCount: 0 }),
  })
  endpointClients.set(url, made)
  return made
}

/** The URL that last served the whole read, tried first next time. */
const preferredUrl = new Map<number, string>()

/**
 * Ask each endpoint, in the SDK's order, to serve the WHOLE read at its own
 * head: logs in one request per query, then every counter pinned to that same
 * block. One node, one block, so the logs and the counters they are checked
 * against describe the same state — a swap landing mid-read cannot turn into a
 * false mismatch. Any failure (a refusal, a short answer caught by the checks,
 * state the node no longer holds) moves on to the next endpoint.
 */
async function readUncached(chainId: DeployedChainId): Promise<ProtocolActivity> {
  const d = DEPLOYMENTS[chainId]
  const listed = logRpcsFor(chainId)
  const first = preferredUrl.get(chainId)
  const urls =
    first !== undefined && listed.includes(first) ? [first, ...listed.filter((u) => u !== first)] : [...listed]

  const refusals: string[] = []
  for (const url of urls) {
    const c = endpointClient(url)
    try {
      /* This endpoint's OWN head, so the range never asks it for a block it
         does not have yet — a node behind the others may answer a future
         `toBlock` with a short list instead of an error. */
      const head = await c.getBlockNumber()
      if (head < d.deployedAtBlock) throw new Error(`head ${head} is below the deployment block`)
      const result = await readAt(chainId, c, head, 'single')
      preferredUrl.set(chainId, url)
      return result
    } catch (e) {
      refusals.push(`${hostOf(url)}: ${reason(e)}`)
    }
  }

  const shared = client(chainId)
  const head = await shared.getBlockNumber()
  const windows = (head - d.deployedAtBlock + FALLBACK_WINDOW_SPAN) / (FALLBACK_WINDOW_SPAN + 1n)
  if (windows > MAX_FALLBACK_WINDOWS) {
    throw new Error(
      `no endpoint served the protocol's log history in one request (${refusals.join('; ')}), and a ` +
        `windowed scan would need ~${windows * 3n} requests, past this panel's budget of ` +
        `${MAX_FALLBACK_WINDOWS * 3n}`,
    )
  }
  return readAt(chainId, shared, head, 'windowed')
}

/* ---------------------------------------------------------------------------
   The read
   --------------------------------------------------------------------------- */

const cache = new Map<number, Promise<ProtocolActivity>>()

export function readProtocolActivity(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<ProtocolActivity> {
  const hit = cache.get(chainId)
  if (hit) return hit
  const p = withDeadline(
    readUncached(chainId),
    READ_DEADLINE_MS,
    `no answer within ${READ_DEADLINE_MS / 1000}s`,
  )
  cache.set(chainId, p)
  p.catch(() => {
    if (cache.get(chainId) === p) cache.delete(chainId)
  })
  return p
}

async function readAt(
  chainId: DeployedChainId,
  c: PublicClient,
  toBlock: bigint,
  method: 'single' | 'windowed',
): Promise<ProtocolActivity> {
  const d = DEPLOYMENTS[chainId]
  const fromBlock = d.deployedAtBlock

  /* Latch's own RevShareHooks: every one the address book lists, current and
     retired, plus the current pointer in case the list ever lags it. */
  const hooks = new Set<string>()
  if (d.revShareHook.toLowerCase() !== ZERO) hooks.add(d.revShareHook.toLowerCase())
  for (const h of d.revShareHooks) {
    if (h.address.toLowerCase() !== ZERO) hooks.add(h.address.toLowerCase())
  }
  const hookList = [...hooks] as Address[]

  const queries: LogQuery[] = [
    async (q, from, to) =>
      (await q.getLogs({ address: d.clPoolManager, event: CL_SWAP, fromBlock: from, toBlock: to })).map(
        (l): ActivityLog => ({
          k: 'swap',
          manager: 'cl',
          poolId: l.args.id as Hex,
          amount0: l.args.amount0 ?? 0n,
          amount1: l.args.amount1 ?? 0n,
          fee: Number(l.args.fee ?? 0),
          protocolFee: Number(l.args.protocolFee ?? 0),
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
        }),
      ),
    async (q, from, to) =>
      (await q.getLogs({ address: d.binPoolManager, event: BIN_SWAP, fromBlock: from, toBlock: to })).map(
        (l): ActivityLog => ({
          k: 'swap',
          manager: 'bin',
          poolId: l.args.id as Hex,
          amount0: l.args.amount0 ?? 0n,
          amount1: l.args.amount1 ?? 0n,
          fee: Number(l.args.fee ?? 0),
          protocolFee: Number(l.args.protocolFee ?? 0),
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
        }),
      ),
  ]
  if (hookList.length > 0) {
    queries.push(async (q, from, to) =>
      (await q.getLogs({ address: hookList, event: REV_SHARE_TAKEN, fromBlock: from, toBlock: to })).map(
        (l): ActivityLog => ({
          k: 'cut',
          hook: l.address,
          poolId: l.args.poolId as Hex,
          currency: l.args.currency as Address,
          lp: l.args.lpDonated ?? 0n,
          creators: l.args.toBeneficiaries ?? 0n,
          holders: l.args.toDistributor ?? 0n,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
        }),
      ),
    )
  }

  const logs: ActivityLog[] = []
  if (method === 'single') {
    for (const q of queries) logs.push(...(await q(c, fromBlock, toBlock)))
  } else {
    logs.push(
      ...(await scanWindowsMulti(
        fromBlock,
        toBlock,
        queries.map((q) => (from: bigint, to: bigint) => q(c, from, to)),
        'protocol activity (Swap, RevShareTaken)',
      )),
    )
  }

  const allSwaps = logs.flatMap((l) => (l.k === 'swap' ? [l] : []))
  const allCuts = logs.flatMap((l) => (l.k === 'cut' ? [l] : []))

  /* Completeness check 1: a cut is taken inside a swap, so its transaction
     must carry a Swap log. One that does not means the swap scan came back
     short. */
  const swapTxs = new Set(allSwaps.map((s) => s.txHash.toLowerCase()))
  const orphans = allCuts.filter((x) => !swapTxs.has(x.txHash.toLowerCase())).length
  if (orphans > 0) {
    throw new Error(
      `the log scan is incomplete: ${orphans} RevShareTaken log(s) have no Swap log in the same ` +
        `transaction, so the endpoint's answer was short and nothing is shown`,
    )
  }

  /* Pool keys, for currencies and for which pools sit on our hooks. */
  const poolRefs = new Map<string, { manager: 'cl' | 'bin'; poolId: Hex }>()
  for (const s of allSwaps) poolRefs.set(`${s.manager}:${s.poolId.toLowerCase()}`, { manager: s.manager, poolId: s.poolId })
  const allKeys = new Map<string, { currency0: Address; currency1: Address; hooks: Address }>()
  await Promise.all(
    [...poolRefs.entries()].map(async ([k, ref]) => {
      const key = await c.readContract({
        address: ref.manager === 'cl' ? d.clPoolManager : d.binPoolManager,
        abi: POOL_MANAGER,
        functionName: 'poolIdToPoolKey',
        args: [ref.poolId],
      })
      allKeys.set(k, { currency0: key[0], currency1: key[1], hooks: key[2] })
    }),
  )

  /* Drop test-token pools from everything below. A cut is matched to its pool
     by id on the CL manager, which is the only manager a RevShareHook serves. */
  const keys = new Map([...allKeys].filter(([, key]) => !tradesTestToken(chainId, key)))
  const hiddenIds = new Set(
    [...allKeys].filter(([, key]) => tradesTestToken(chainId, key)).map(([k]) => k),
  )
  const swaps = allSwaps.filter((s) => !hiddenIds.has(`${s.manager}:${s.poolId.toLowerCase()}`))
  const cuts = allCuts.filter((x) => !hiddenIds.has(`cl:${x.poolId.toLowerCase()}`))

  /* Per-token aggregation. */
  const tokens = new Map<string, TokenActivity>()
  const tokenOf = (address: Address): TokenActivity => {
    const k = address.toLowerCase()
    const hit = tokens.get(k)
    if (hit) return hit
    const made: TokenActivity = {
      address,
      symbol: null,
      decimals: null,
      swapsIn: 0,
      volumeIn: 0n,
      lpSwapFee: 0n,
      protocolSwapFee: 0n,
      protocolFeeSwaps: 0,
      cutLp: 0n,
      cutCreators: 0n,
      cutHolders: 0n,
      protocolAccrued: 0n,
    }
    tokens.set(k, made)
    return made
  }

  for (const s of swaps) {
    const key = keys.get(`${s.manager}:${s.poolId.toLowerCase()}`)
    if (!key) continue
    /* The input is the NEGATIVE delta — the caller pays it. A swap with no
       negative side moved nothing in and is counted as a swap only. */
    const in0 = s.amount0 < 0n
    const in1 = !in0 && s.amount1 < 0n
    if (!in0 && !in1) continue
    const gross = in0 ? -s.amount0 : -s.amount1
    const t = tokenOf(in0 ? key.currency0 : key.currency1)
    const total = (gross * BigInt(s.fee)) / PIPS
    const protocol = (gross * BigInt(s.protocolFee)) / PIPS
    t.swapsIn += 1
    t.volumeIn += gross
    t.protocolSwapFee += protocol
    if (s.protocolFee > 0) t.protocolFeeSwaps += 1
    t.lpSwapFee += total > protocol ? total - protocol : 0n
  }

  const cutSums = new Map<string, { hook: Address; poolId: Hex; currency: Address; sum: bigint }>()
  for (const x of cuts) {
    const t = tokenOf(x.currency)
    t.cutLp += x.lp
    t.cutCreators += x.creators
    t.cutHolders += x.holders
    const k = `${x.hook.toLowerCase()}:${x.poolId.toLowerCase()}:${x.currency.toLowerCase()}`
    const row = cutSums.get(k) ?? { hook: x.hook, poolId: x.poolId, currency: x.currency, sum: 0n }
    row.sum += x.lp + x.creators + x.holders
    cutSums.set(k, row)
  }

  /* Completeness check 2: every swapped pool on one of our hooks is checked
     against its counter, including pools with NO cut logs — a scan that
     missed all of a pool's logs would otherwise never be asked. */
  for (const [k, key] of keys) {
    if (!k.startsWith('cl:') || !hooks.has(key.hooks.toLowerCase())) continue
    const poolId = k.slice(3) as Hex
    for (const currency of [key.currency0, key.currency1]) {
      const ck = `${key.hooks.toLowerCase()}:${poolId}:${currency.toLowerCase()}`
      if (!cutSums.has(ck)) cutSums.set(ck, { hook: key.hooks, poolId, currency, sum: 0n })
    }
  }

  let verified = 0
  let unavailable = 0
  await Promise.all(
    [...cutSums.values()].map(async (row) => {
      try {
        const counter = await c.readContract({
          blockNumber: toBlock,
          address: row.hook,
          abi: REV_SHARE_HOOK,
          functionName: 'totalTaken',
          args: [row.poolId, row.currency],
        })
        if (counter !== row.sum) {
          throw new Error(
            `the log scan is incomplete: RevShareTaken logs sum to ${row.sum} for pool ` +
              `${row.poolId.slice(0, 10)}… but totalTaken reads ${counter}, so nothing is shown`,
          )
        }
        verified += 1
      } catch (e) {
        if (!isRevert(e)) throw e
        unavailable += 1
      }
    }),
  )
  const pairs = verified + unavailable
  const cutCheck: CutCheck =
    pairs === 0
      ? { k: 'none' }
      : unavailable > 0
        ? { k: 'unavailable', pairs, verified }
        : { k: 'verified', pairs }

  /* Metadata and the uncollected-protocol-fee counters. */
  const book = d.tokens
  await Promise.all(
    [...tokens.values()].map(async (t) => {
      const [accruedCl, accruedBin] = await Promise.all([
        c.readContract({ blockNumber: toBlock, address: d.clPoolManager, abi: POOL_MANAGER, functionName: 'protocolFeesAccrued', args: [t.address] }),
        c.readContract({ blockNumber: toBlock, address: d.binPoolManager, abi: POOL_MANAGER, functionName: 'protocolFeesAccrued', args: [t.address] }),
      ])
      t.protocolAccrued = accruedCl + accruedBin

      if (t.address.toLowerCase() === ZERO) {
        t.symbol = d.nativeCurrency.symbol
        t.decimals = d.nativeCurrency.decimals
        return
      }
      const known = book.find((b) => b.address.toLowerCase() === t.address.toLowerCase())
      if (known) {
        t.symbol = known.symbol
        t.decimals = known.decimals
        return
      }
      const [symbol, decimals] = await Promise.allSettled([
        c.readContract({ address: t.address, abi: ERC20, functionName: 'symbol' }),
        c.readContract({ address: t.address, abi: ERC20, functionName: 'decimals' }),
      ])
      t.symbol = symbol.status === 'fulfilled' ? symbol.value : null
      t.decimals = decimals.status === 'fulfilled' ? decimals.value : null
    }),
  )

  const bookIndex = (a: Address): number => {
    const i = book.findIndex((b) => b.address.toLowerCase() === a.toLowerCase())
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }

  return {
    chainId,
    fromBlock,
    toBlock,
    method,
    swapCount: swaps.length,
    swapBlocks: [...new Set(swaps.map((s) => s.blockNumber))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    poolCount: keys.size,
    cutHooks: hookList.length,
    hiddenTestPools: hiddenIds.size,
    cutCheck,
    tokens: [...tokens.values()].sort(
      (a, b) => bookIndex(a.address) - bookIndex(b.address) || a.address.localeCompare(b.address),
    ),
  }
}

/* ---------------------------------------------------------------------------
   Formatting
   --------------------------------------------------------------------------- */

/**
 * A token amount in its own units: grouped whole part, and enough decimals to
 * show four significant digits of a small fee (capped at 8), trailing zeros
 * trimmed to a minimum of two. A real zero is "0". Without decimals the raw
 * integer is returned and the caller must say "base units".
 */
export function formatTokenAmount(v: bigint, decimals: number | null): string {
  if (decimals === null) return v.toLocaleString('en-US')
  if (v === 0n) return '0'
  const neg = v < 0n
  const abs = neg ? -v : v
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const fracRaw = (abs % base).toString().padStart(decimals, '0')

  let places = 2
  if (whole === 0n) {
    const lead = fracRaw.search(/[1-9]/)
    places = lead === -1 ? 2 : Math.min(8, Math.max(2, lead + 4))
  } else if (whole < 1000n) {
    places = 4
  }
  places = Math.min(places, decimals)
  /* A non-zero amount below the smallest place shown must never print as a
     zero: that is the "0 that means we could not look" failure in miniature. */
  if (whole === 0n && !/[1-9]/.test(fracRaw.slice(0, places))) {
    return `${neg ? '>-' : '<'}0.${'0'.repeat(Math.max(0, places - 1))}1`
  }
  let frac = fracRaw.slice(0, places)
  while (frac.length > 2 && frac.endsWith('0')) frac = frac.slice(0, -1)
  const body = frac.length > 0 ? `${whole.toLocaleString('en-US')}.${frac}` : whole.toLocaleString('en-US')
  return neg ? `-${body}` : body
}
