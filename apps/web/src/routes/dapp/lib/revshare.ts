/* ============================================================================
   The revenue-share data layer.

   One module behind four screens: /app/protocol, /app/protocol/:poolId,
   /app/protocol/:poolId/epochs and /app/claim.

   Same rule as `lib/chain.ts`: NOTHING HERE INVENTS A NUMBER. Every value is
   an `eth_call` or an `eth_getLogs` against a deployed contract. A read that
   fails throws, and the screen renders an error — never a zero, never a
   placeholder.

   Five things about `RevShareHook` shape this whole file. They are limitations
   of the contract, not of the UI, and the UI's job is to state them rather
   than paper over them:

   1. A PoolKey CANNOT BE DERIVED FROM A PoolId. The id is `keccak(abi.encode(
      key))`; there is no inverse. Every owner and maintenance call takes a
      `PoolKey calldata`, so a screen holding only an id cannot build the
      calldata. `resolvePoolKey` below finds the key where it is actually
      recorded — a distributor's `poolKey()`, the CL pool manager's
      `poolIdToPoolKey(id)`, or its `Initialize` log — and returns null when
      none answers. A null there disables the write buttons and says why; it
      never produces a guessed key.

      THE KEY ALSO NAMES THE HOOK. `poolKey.hooks` is part of the pool id, so a
      pool lives on exactly one hook forever. These screens used to read every
      pool id against the address book's CURRENT hook — which hosts no pools —
      while the test-token pool lives on the retired 0x23CE…. `resolvePoolHook` reads the
      hook out of the pool's own key instead.

   2. LIFETIME TOTALS ARE SUMMED FROM LOGS. `readLifetime` sums
      `RevShareTaken` and returns the block range it summed, which the UI
      prints. Both Robinhood hooks also keep a `totalTaken(poolId, currency)`
      counter, which the UI shows beside the sum where the hook answers; the
      Sepolia hook predates the counter and reverts.

   3. `claimable` IS KEYED (recipient, currency) GLOBALLY. Not per pool. A
      beneficiary of two pools has ONE balance, and `claim(currency, to)` pays
      all of it. No view function can decompose it, so nothing here pretends
      to — see `readGlobalClaimable`.

   4. `distributorOf` RETURNS A BARE ADDRESS. Which distributor sits behind it
      is decided by asking it: `probeDistributor` reads
      `IEpochDistributor.kind()` and accepts only an exact match on one of the
      two constants. A revert, zero, or any other value is 'unknown' — never a
      guessed type, and never a fallback to the old `token()` /
      `challengeDelay()` selector probe. An RPC failure throws instead.

   5. MERKLE PROOFS HAVE NO ON-CHAIN PUBLICATION CHANNEL. Nothing here can
      build a `MerkleEpochDistributor.claim` call, and no function that tries
      exists in this file.
   ============================================================================ */

import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  ExecutionRevertedError,
  UserRejectedRequestError,
  getAddress,
  isAddress,
  type Abi,
  type Address,
  type Hex,
} from 'viem'

import {
  DEPLOYMENTS,
  ACTIVE_CHAIN_ID,
  client,
  formatUnits,
  readContractClockReading,
  classifyReadFailure,
  scanWindows,
  scanWindowsBackward,
  scanWindowsMulti,
  type DeployedChainId,
} from '../../../lib/chain'
import {
  CL_INITIALIZE_EVENT,
  DISTRIBUTOR_KIND,
  DISTRIBUTOR_KIND_ABI,
  ERC20_META_ABI,
  MERKLE_DISTRIBUTOR_ABI,
  POOL_CLAIMED_EVENT,
  POOL_OWNER_CHANGED_EVENT,
  REV_SHARE_HOOK_ABI,
  REV_SHARE_TAKEN_EVENT,
  SNAPSHOT_DISTRIBUTOR_ABI,
} from './revshareAbi'
import {
  readPendingConfig,
  type DecodedPendingConfig,
  type DurationClock,
} from '../../../lib/pendingConfig'

export const REVSHARE_CHAIN_ID: DeployedChainId = ACTIVE_CHAIN_ID
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** `PIPS_DENOMINATOR` on the hook. A fee of 3_000 pips is 0.3%. */
export const PIPS_DENOMINATOR = 1_000_000
/** `SPLIT_DENOMINATOR` on the hook. The three shares must sum to exactly this. */
export const SPLIT_DENOMINATOR = 10_000

/* ---------------------------------------------------------------------------
   Which hook are we looking at?

   `DEPLOYMENTS` now carries a `revShareHook` per chain, but this resolver stays
   because an operator may point these screens at their OWN hook rather than the
   canonical one. Absence remains a first-class state — a chain with no hook
   renders "not deployed on this chain" rather than reading from nowhere and
   showing zeros, which would be indistinguishable from a hook that took
   nothing.

   Two sources, in order:
     ?hook=0x…                    a specific hook, for an operator running
                                  their own deployment. Always labelled in the
                                  UI as coming from the URL.
     VITE_REVSHARE_HOOK           a build-time default.
   --------------------------------------------------------------------------- */

export interface HookRef {
  address: Address
  source: 'url' | 'build' | 'deployment' | 'pool-key'
  /** The address book's verdict, when it knows the hook. */
  status?: 'current' | 'retired'
}

/** Every RevShareHook the address book lists for this build's chain — current
    first, then each retired one that still hosts pools. */
export const KNOWN_HOOKS: readonly HookRef[] = [...DEPLOYMENTS[ACTIVE_CHAIN_ID].revShareHooks]
  .sort((a, b) => (a.status === b.status ? 0 : a.status === 'current' ? -1 : 1))
  .map((h) => ({ address: getAddress(h.address), source: 'deployment' as const, status: h.status }))

/** The address book's status for a hook address, if it lists it. */
export function knownHookStatus(address: string): 'current' | 'retired' | undefined {
  return KNOWN_HOOKS.find((h) => h.address.toLowerCase() === address.toLowerCase())?.status
}

const ENV_HOOK = ((): Address | null => {
  const raw = (import.meta.env as Record<string, string | undefined>)['VITE_REVSHARE_HOOK']
  if (typeof raw !== 'string' || !isAddress(raw.trim(), { strict: false })) return null
  return getAddress(raw.trim())
})()

/* The canonical hook for this build's chain, when one is deployed. Added after
   RevShareHook went live on Robinhood: the address sat in DEPLOYMENTS while
   this resolver still only knew about `?hook=` and the env var, so all four
   revenue screens reported "no RevShareHook to read" on a chain that had one. */
const DEPLOYED_HOOK = ((): Address | null => {
  const raw = (DEPLOYMENTS[ACTIVE_CHAIN_ID] as { revShareHook?: string }).revShareHook
  if (typeof raw !== 'string' || !isAddress(raw, { strict: false })) return null
  return getAddress(raw)
})()

/**
 * Resolve the hook to read, most specific first.
 *
 *   ?hook=0x…            an operator inspecting a hook that is not ours
 *   VITE_REVSHARE_HOOK   a build-time override
 *   DEPLOYMENTS          the canonical hook for this chain
 *
 * The URL wins over the build so somebody can look at their own deployment
 * without rebuilding, and the env var wins over DEPLOYMENTS so a staging build
 * can point somewhere else. Absence is still a real state: a chain with no hook
 * renders "not deployed on this chain" rather than reading zeros off nothing.
 */
export function resolveHook(urlParam: string | null | undefined): HookRef | null {
  return resolveHooks(urlParam)[0] ?? null
}

/**
 * Every hook a screen that is not about one pool should read.
 *
 *   ?hook= or VITE_REVSHARE_HOOK   exactly that hook (an explicit choice)
 *   otherwise                      every RevShareHook in the address book,
 *                                  current AND retired — a retired hook's pools,
 *                                  claimable balances and proposals are still live
 */
export function resolveHooks(urlParam: string | null | undefined): HookRef[] {
  const trimmed = urlParam?.trim() ?? ''
  if (trimmed !== '' && isAddress(trimmed, { strict: false })) {
    const address = getAddress(trimmed)
    const status = knownHookStatus(address)
    return [{ address, source: 'url', ...(status ? { status } : {}) }]
  }
  if (ENV_HOOK) {
    const status = knownHookStatus(ENV_HOOK)
    return [{ address: ENV_HOOK, source: 'build', ...(status ? { status } : {}) }]
  }
  if (KNOWN_HOOKS.length > 0) return [...KNOWN_HOOKS]
  if (DEPLOYED_HOOK) return [{ address: DEPLOYED_HOOK, source: 'deployment' }]
  return []
}

/** True when a `?hook=` was supplied but is not an address — worth saying so. */
export function hookParamIsMalformed(urlParam: string | null | undefined): boolean {
  const trimmed = urlParam?.trim() ?? ''
  return trimmed !== '' && !isAddress(trimmed, { strict: false })
}

export function isPoolId(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim())
}

/* ---------------------------------------------------------------------------
   Tokens
   --------------------------------------------------------------------------- */

export interface TokenMeta {
  address: Address
  symbol: string
  /**
   * Null when `decimals()` could not be read. Amounts of such a token are
   * printed in BASE UNITS with that said out loud — scaling by an assumed 18
   * would be a fabricated figure.
   */
  decimals: number | null
}

const tokenCache = new Map<string, TokenMeta>()

export async function readToken(address: Address): Promise<TokenMeta> {
  const key = address.toLowerCase()
  const hit = tokenCache.get(key)
  if (hit) return hit

  const c = client(REVSHARE_CHAIN_ID)
  const [symbol, decimals] = await Promise.all([
    c
      .readContract({ address, abi: ERC20_META_ABI, functionName: 'symbol' })
      .catch(() => null),
    c
      .readContract({ address, abi: ERC20_META_ABI, functionName: 'decimals' })
      .catch(() => null),
  ])

  const meta: TokenMeta = {
    address,
    symbol: typeof symbol === 'string' && symbol !== '' ? symbol : `${address.slice(0, 6)}…${address.slice(-4)}`,
    decimals: typeof decimals === 'number' ? decimals : null,
  }
  tokenCache.set(key, meta)
  return meta
}

/** Thousands separators, six decimals max, never a "0.00" that hides a balance. */
export function fmtAmount(v: bigint, decimals: number): string {
  if (v === 0n) return '0'
  const s = formatUnits(v, decimals, 6)
  const [whole = '0', frac = ''] = s.split('.')
  const trimmed = frac.replace(/0+$/, '')
  const wholeFmt = BigInt(whole).toLocaleString('en-US')
  if (wholeFmt === '0' && trimmed === '') return '<0.000001'
  return trimmed ? `${wholeFmt}.${trimmed}` : wholeFmt
}

/** An amount with its unit. Unknown decimals produce base units, said plainly. */
export function amountWithUnit(v: bigint, token: TokenMeta): string {
  if (token.decimals === null) return `${v.toLocaleString('en-US')} base units (${token.symbol})`
  return `${fmtAmount(v, token.decimals)} ${token.symbol}`
}

/* ---------------------------------------------------------------------------
   PoolKey resolution — constraint 1
   --------------------------------------------------------------------------- */

export interface PoolKeyStruct {
  currency0: Address
  currency1: Address
  hooks: Address
  poolManager: Address
  fee: number
  parameters: Hex
}

export type PoolKeyTuple = readonly [Address, Address, Address, Address, number, Hex]

/** viem takes the struct positionally, in the order core declares it. */
export function keyTuple(k: PoolKeyStruct): PoolKeyTuple {
  return [k.currency0, k.currency1, k.hooks, k.poolManager, k.fee, k.parameters]
}

export interface KeyResolution {
  key: PoolKeyStruct
  /** Where the key came from. Shown in the UI — provenance is the point. */
  via: 'distributor.poolKey()' | 'CLPoolManager.poolIdToPoolKey()' | 'CLPoolManager.Initialize log'
  /** Only set for the log path: the first block scanned. */
  scannedFrom?: bigint
}

/**
 * Find the `PoolKey` for a `PoolId`, or return null.
 *
 * Order matters. A distributor stores the key in contract storage, so reading
 * it is one call and cannot be truncated by an RPC's log window. The log scan
 * is the fallback, and it only reaches back to the protocol's deploy block.
 *
 * Returns null for a pool with no distributor whose `Initialize` log is
 * outside the scanned range, or for a Bin pool (this hook is CL-only, so that
 * case should not arise, but a null is the honest answer either way).
 */
export async function resolvePoolKey(
  poolId: Hex,
  distributor: Address | null,
  poolManager: Address,
): Promise<KeyResolution | null> {
  const c = client(REVSHARE_CHAIN_ID)

  if (distributor && distributor !== ZERO_ADDRESS) {
    /* Both distributors expose an identical `poolKey()`; either ABI decodes it. */
    const stored = await c
      .readContract({ address: distributor, abi: SNAPSHOT_DISTRIBUTOR_ABI, functionName: 'poolKey' })
      .catch(() => null)
    if (stored) {
      return {
        key: {
          currency0: stored.currency0,
          currency1: stored.currency1,
          hooks: stored.hooks,
          poolManager: stored.poolManager,
          fee: Number(stored.fee),
          parameters: stored.parameters,
        },
        via: 'distributor.poolKey()',
      }
    }
  }

  /* ONE eth_call: the pool manager stores every initialized pool's key. */
  const recorded = await readRecordedPoolKey(poolId, poolManager)
  if (recorded) return { key: recorded, via: 'CLPoolManager.poolIdToPoolKey()' }

  const fromBlock = DEPLOYMENTS[REVSHARE_CHAIN_ID].deployedAtBlock

  /* WINDOWED, AND BACKWARD WITH limit 1. This was a single
     `deployedAtBlock -> 'latest'` call that the Robinhood endpoints refuse, so
     the pool screen could never resolve a key and every owner action stayed
     disabled with the wrong reason printed beside it.

     Backward is safe here and much cheaper than an exhaustive sweep: a pool id
     is `keccak(abi.encode(key))`, and `Initialize` can fire at most once for
     one id, so the newest match IS the only match. A forward scan would have to
     walk the protocol's whole history to prove the same thing. */
  const logs = await scanWindowsBackward(
    fromBlock,
    await c.getBlockNumber(),
    1,
    (from, to) =>
      c.getLogs({
        address: poolManager,
        event: CL_INITIALIZE_EVENT,
        args: { id: poolId },
        fromBlock: from,
        toBlock: to,
      }),
    'pool key (CLPoolManager Initialize)',
  )

  const log = logs[0]
  if (!log?.args) return null
  const { currency0, currency1, hooks, fee, parameters } = log.args
  if (!currency0 || !currency1 || !hooks || fee === undefined || !parameters) return null

  return {
    key: {
      currency0,
      currency1,
      hooks,
      /* The event does not carry it: for a CL pool the manager is the emitter. */
      poolManager,
      fee: Number(fee),
      parameters,
    },
    via: 'CLPoolManager.Initialize log',
    scannedFrom: fromBlock,
  }
}

const POOL_ID_TO_KEY_ABI = [
  {
    type: 'function',
    name: 'poolIdToPoolKey',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'hooks', type: 'address' },
      { name: 'poolManager', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'parameters', type: 'bytes32' },
    ],
  },
] as const

/**
 * `poolIdToPoolKey(id)` on a CL pool manager — the key the manager recorded at
 * `initialize`. A pool the manager never initialized reads back a zero struct,
 * so a key is accepted only when its `poolManager` is the manager asked.
 * A transport failure throws; only "not recorded" is null.
 */
export async function readRecordedPoolKey(poolId: Hex, poolManager: Address): Promise<PoolKeyStruct | null> {
  const c = client(REVSHARE_CHAIN_ID)
  const [currency0, currency1, hooks, manager, fee, parameters] = await c.readContract({
    address: poolManager,
    abi: POOL_ID_TO_KEY_ABI,
    functionName: 'poolIdToPoolKey',
    args: [poolId],
  })
  if (manager.toLowerCase() !== poolManager.toLowerCase()) return null
  return { currency0, currency1, hooks, poolManager: manager, fee: Number(fee), parameters }
}

export type PoolHookResolution =
  | { k: 'found'; hook: HookRef; key: PoolKeyStruct }
  | { k: 'no-hook'; key: PoolKeyStruct }
  | { k: 'not-initialized' }

/**
 * Which hook a pool lives on, read from the pool's own key on the build's CL
 * pool manager. The hook is part of the pool id, so this is the only answer —
 * no address-book guess can be more right than it.
 */
export async function resolvePoolHook(poolId: Hex): Promise<PoolHookResolution> {
  const key = await readRecordedPoolKey(poolId, DEPLOYMENTS[REVSHARE_CHAIN_ID].clPoolManager)
  if (!key) return { k: 'not-initialized' }
  if (key.hooks.toLowerCase() === ZERO_ADDRESS) return { k: 'no-hook', key }
  const address = getAddress(key.hooks)
  const status = knownHookStatus(address)
  return { k: 'found', key, hook: { address, source: 'pool-key', ...(status ? { status } : {}) } }
}

/* ---------------------------------------------------------------------------
   Config
   --------------------------------------------------------------------------- */

export interface PoolConfig {
  owner: Address
  feePips: number
  lpDonateBps: number
  beneficiaryBps: number
  distributorBps: number
  enabled: boolean
  frozen: boolean
}

export interface ConfigParams {
  feePips: number
  lpDonateBps: number
  beneficiaryBps: number
  distributorBps: number
  distributor: Address
  enabled: boolean
}

/**
 * A decoded `getPendingConfig`, in the hook's own shape and clock. See
 * `lib/pendingConfig.ts`: `effective` / `expiry` are unix seconds on a
 * timestamp hook and CONTRACT block numbers on a block hook, and `expiry` is
 * null on the no-expiry hook — never replaced with a number.
 */
export type PendingConfig = DecodedPendingConfig

export interface Beneficiary {
  recipient: Address
  weight: bigint
}

/** `feePips` as a percentage string. 3_000 pips → "0.3%". */
export function pipsPct(feePips: number): string {
  const pct = (feePips / PIPS_DENOMINATOR) * 100
  return `${Number(pct.toFixed(4))}%`
}

/** A split share in bps as a percentage string. 5_000 bps → "50%". */
export function bpsPct(bps: number): string {
  const pct = (bps / SPLIT_DENOMINATOR) * 100
  return `${Number(pct.toFixed(2))}%`
}

/* ---------------------------------------------------------------------------
   Lifetime totals — constraint 2
   --------------------------------------------------------------------------- */

export interface LifetimeRow {
  token: TokenMeta
  lpDonated: bigint
  toBeneficiaries: bigint
  toDistributor: bigint
  /**
   * `totalTaken(poolId, currency)` — the hook's own lifetime counter, read at the
   * scan's `toBlock`. `null` when the hook predates the counter and reverts.
   */
  counter: bigint | null
}

export interface Lifetime {
  rows: LifetimeRow[]
  /** How many `RevShareTaken` logs were summed. Zero is a real answer. */
  events: number
  /** First block scanned. There is no counter before this. */
  fromBlock: bigint
  /** Head at the time of the scan. */
  toBlock: bigint
}

/**
 * Sum `RevShareTaken` for one pool.
 *
 * A sum over a scanned window, and every caller must label it as one. Each row
 * also carries the hook's own `totalTaken(poolId, currency)` counter where the
 * hook has one (both Robinhood hooks do; Sepolia's reverts), so a scan that came
 * back short is visible as a mismatch rather than silently low.
 */
export async function readLifetime(hook: Address, poolId: Hex): Promise<Lifetime> {
  /* `totalTaken` exists on both Robinhood hooks and is shown beside this sum;
     the log stream stays the source because it carries the three-way split
     the counter does not. */
  const c = client(REVSHARE_CHAIN_ID)
  const fromBlock = DEPLOYMENTS[REVSHARE_CHAIN_ID].deployedAtBlock

  /* WINDOWED, and the head is read FIRST so the range the scan covers is
     exactly the range reported back as `toBlock`. Asking for `'latest'` while
     separately reading the head lets the two disagree by however long the scan
     takes, and this figure is printed as provenance — "summed from logs since
     block N (head M)" has to be true of the sum it labels.

     Exhaustive: this is a total. A window dropped from a sum is a wrong number,
     not a slow one, and the hook keeps no cumulative counter to check it
     against. */
  const toBlock = await c.getBlockNumber()
  const logs = await scanWindows(
    fromBlock,
    toBlock,
    (from, to) =>
      c.getLogs({
        address: hook,
        event: REV_SHARE_TAKEN_EVENT,
        args: { poolId },
        fromBlock: from,
        toBlock: to,
      }),
    'pool lifetime totals (RevShareTaken)',
  )

  const acc = new Map<string, { address: Address; lp: bigint; ben: bigint; dist: bigint }>()
  for (const log of logs) {
    const currency = log.args.currency
    if (!currency) continue
    const k = currency.toLowerCase()
    const row = acc.get(k) ?? { address: currency, lp: 0n, ben: 0n, dist: 0n }
    row.lp += log.args.lpDonated ?? 0n
    row.ben += log.args.toBeneficiaries ?? 0n
    row.dist += log.args.toDistributor ?? 0n
    acc.set(k, row)
  }

  const rows = await Promise.all(
    [...acc.values()].map(async (r) => ({
      token: await readToken(r.address),
      lpDonated: r.lp,
      toBeneficiaries: r.ben,
      toDistributor: r.dist,
      counter: await c
        .readContract({
          address: hook,
          abi: REV_SHARE_HOOK_ABI,
          functionName: 'totalTaken',
          args: [poolId, r.address],
          blockNumber: toBlock,
        })
        .catch((e: unknown) => {
          /* A revert is "this hook has no counter". Anything else is the chain
             failing to answer, and must not read as that. */
          if (classifyReadFailure(e) === 'transport') throw e
          return null
        }),
    })),
  )

  return { rows, events: logs.length, fromBlock, toBlock }
}

/* ---------------------------------------------------------------------------
   Screen B — one pool, in full
   --------------------------------------------------------------------------- */

export interface UnsettledRow {
  token: TokenMeta
  /** `pendingBeneficiary(poolId, currency)` — waiting for `settleBeneficiaries`. */
  beneficiary: bigint
  /** `pendingDistributorShare(poolId, currency)` — waiting for the distributor to pull. */
  distributor: bigint
}

export interface PoolOverview {
  poolId: Hex
  hook: Address
  config: PoolConfig
  pending: PendingConfig
  beneficiaries: Beneficiary[]
  totalWeight: bigint
  distributor: Address | null
  pendingOwner: Address | null
  paused: boolean
  /**
   * The fee-raise delay, in the hook's own unit: `CONFIG_DELAY_SECONDS` on a
   * timestamp hook, `CONFIG_DELAY_BLOCKS` (contract blocks) on a block hook.
   */
  configDelay: { clock: DurationClock; value: bigint }
  /** `eth_blockNumber` — the log clock. The L2 head on Robinhood. */
  blockNumber: bigint
  /**
   * The hook's own `block.number` — Ethereum's on Robinhood. A block hook's
   * `pending.effective` / `expiry` are on THIS clock and only ever compared to it.
   */
  contractBlockNumber: bigint
  /** `block.timestamp` of the latest block. A timestamp hook's pending window is compared to THIS. */
  timestamp: bigint
  poolManager: Address
  resolution: KeyResolution | null
  /**
   * The pool's two currencies. Sourced from the resolved key; when the key
   * could not be resolved these are whatever currencies appear in the pool's
   * `RevShareTaken` logs, which may be a subset (a currency that has never
   * accrued anything never appears).
   */
  currencies: TokenMeta[]
  currenciesFrom: 'poolKey' | 'RevShareTaken logs'
  unsettled: UnsettledRow[]
  lifetime: Lifetime
}

export type PoolLoad =
  | { k: 'no-code'; hook: Address }
  | { k: 'not-a-hook'; hook: Address; detail: string }
  | { k: 'not-configured'; hook: Address; poolId: Hex }
  | { k: 'ready'; o: PoolOverview }

/**
 * Everything screen B renders, in one pass.
 *
 * NOT-CONFIGURED IS A REAL STATE, AND IT IS NOT A ZEROED CONFIG.
 * `getConfig` does NOT revert `PoolNotConfigured` — it is a plain mapping read
 * and returns a zero-filled struct for a pool it has never seen. The
 * discriminator is `config.owner == address(0)`: `configure()` is the only
 * writer of `owner`, and it can never write zero. Rendering the zero struct as
 * a 0% fee with a disabled flag would look exactly like a real, deliberately
 * disabled configuration, so this function refuses to return one.
 */
export async function readPoolOverview(hook: Address, poolId: Hex): Promise<PoolLoad> {
  const c = client(REVSHARE_CHAIN_ID)

  const code = await c.getCode({ address: hook })
  if (!code || code.length <= 2) return { k: 'no-code', hook }

  const read = <T,>(functionName: string, args: readonly unknown[]) =>
    c.readContract({
      address: hook,
      abi: REV_SHARE_HOOK_ABI,
      functionName: functionName as 'getConfig',
      args: args as never,
    }) as Promise<T>

  /* A contract that is not a RevShareHook has no `getConfig`, and the call
     reverts. That is a verdict about the ADDRESS, not about the chain, and
     conflating the two would tell a reader the RPC is down when it answered
     perfectly. Only this first read is treated that way — once the address has
     proved it answers as a hook, a later failure really is a chain problem. */
  let rawConfig: PoolConfig
  try {
    rawConfig = await read<PoolConfig>('getConfig', [poolId])
  } catch (e) {
    return { k: 'not-a-hook', hook, detail: e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e) }
  }
  if (rawConfig.owner === ZERO_ADDRESS) return { k: 'not-configured', hook, poolId }

  /* `getPendingConfig` is read RAW and decoded in the hook's own shape — never
     through `read`. Three struct shapes exist on chain and two share a length.
     A failure here throws into the screen's error state; it is never caught
     into "no proposal". */
  const [pending, rawBeneficiaries, totalWeight, distributorRaw, pendingOwnerRaw, paused, clock, poolManager] =
    await Promise.all([
      readPendingConfig(c, REVSHARE_CHAIN_ID, hook, poolId),
      read<readonly Beneficiary[]>('getBeneficiaries', [poolId]),
      read<bigint>('totalWeight', [poolId]),
      read<Address>('distributorOf', [poolId]),
      read<Address>('pendingPoolOwner', [poolId]),
      read<boolean>('paused', []),
      /* Both clocks in one read: `timestamp` for a timestamp hook, the contract
         block number for a block hook. `getBlockNumber()` is the L2 head on
         Robinhood and neither of those. */
      readContractClockReading(REVSHARE_CHAIN_ID),
      read<Address>('poolManager', []),
    ])
  /* The delay getter exists under exactly one name per build. */
  const delayValue =
    pending.durationClock === 'timestamp'
      ? await read<number | bigint>('CONFIG_DELAY_SECONDS', [])
      : await read<bigint>('CONFIG_DELAY_BLOCKS', [])

  const distributor = distributorRaw === ZERO_ADDRESS ? null : distributorRaw

  const [resolution, lifetime] = await Promise.all([
    resolvePoolKey(poolId, distributor, poolManager),
    readLifetime(hook, poolId),
  ])

  let currencies: TokenMeta[]
  let currenciesFrom: PoolOverview['currenciesFrom']
  if (resolution) {
    currencies = await Promise.all([
      readToken(resolution.key.currency0),
      readToken(resolution.key.currency1),
    ])
    currenciesFrom = 'poolKey'
  } else {
    currencies = lifetime.rows.map((r) => r.token)
    currenciesFrom = 'RevShareTaken logs'
  }

  const unsettled = await Promise.all(
    currencies.map(async (token) => ({
      token,
      beneficiary: await read<bigint>('pendingBeneficiary', [poolId, token.address]),
      distributor: await read<bigint>('pendingDistributorShare', [poolId, token.address]),
    })),
  )

  return {
    k: 'ready',
    o: {
      poolId,
      hook,
      config: {
        owner: rawConfig.owner,
        feePips: Number(rawConfig.feePips),
        lpDonateBps: Number(rawConfig.lpDonateBps),
        beneficiaryBps: Number(rawConfig.beneficiaryBps),
        distributorBps: Number(rawConfig.distributorBps),
        enabled: rawConfig.enabled,
        frozen: rawConfig.frozen,
      },
      pending,
      beneficiaries: rawBeneficiaries.map((b) => ({ recipient: b.recipient, weight: BigInt(b.weight) })),
      totalWeight,
      distributor,
      pendingOwner: pendingOwnerRaw === ZERO_ADDRESS ? null : pendingOwnerRaw,
      paused,
      configDelay: { clock: pending.durationClock, value: BigInt(delayValue) },
      blockNumber: clock.rpcBlockNumber,
      contractBlockNumber: clock.contractBlockNumber,
      timestamp: clock.timestamp,
      poolManager,
      resolution,
      currencies,
      currenciesFrom,
      unsettled,
      lifetime,
    },
  }
}

/* ---------------------------------------------------------------------------
   Screen A — pools an address owns
   --------------------------------------------------------------------------- */

export interface OwnedPool {
  /** The hook this pool's configuration lives on. */
  hook: HookRef
  poolId: Hex
  config: PoolConfig
  distributor: Address | null
  /** `getPendingConfig()`'s effective point; 0 when nothing is proposed. */
  pendingEffective: bigint
  /** The expiry, inclusive; null on the no-expiry hook. */
  pendingExpiry: bigint | null
  /** Unit of the two fields above. */
  pendingDurationClock: DurationClock
}

export interface OwnedPools {
  pools: OwnedPool[]
  /** Ids seen in the logs whose current `poolOwner` is someone else. */
  transferredAway: number
  /** Log-scan range, on the L2 (RPC) clock. */
  fromBlock: bigint
  toBlock: bigint
  /** `eth_blockNumber` at scan time. Equal to `toBlock`. */
  blockNumber: bigint
  /** The hook's `block.number`. A block hook's proposal status is judged against this, never `blockNumber`. */
  contractBlockNumber: bigint
  /** `block.timestamp`. A timestamp hook's proposal status is judged against this. */
  timestamp: bigint
}

/**
 * Pools whose CURRENT owner is `owner`.
 *
 * Enumeration is by log, because there is no `poolsOf(address)` on the hook —
 * `PoolClaimed(poolId, owner)` for a first configuration, plus
 * `PoolOwnerChanged(poolId, from, to)` for every transfer since. Both are
 * indexed on the address, so the RPC does the filtering.
 *
 * The logs are only a CANDIDATE LIST. Every candidate is then checked against
 * `poolOwner(poolId)`, which is the current truth: that is what reconciles a
 * pool claimed by this address and later handed to somebody else, and it makes
 * the result correct even if the log scan missed a transfer.
 */
export async function readOwnedPools(hooks: readonly HookRef[], owner: Address): Promise<OwnedPools> {
  const c = client(REVSHARE_CHAIN_ID)
  const fromBlock = DEPLOYMENTS[REVSHARE_CHAIN_ID].deployedAtBlock
  /* EVERY known hook in ONE query each: `getLogs` takes an address list, and
     `l.address` says which hook emitted. A pool claimed on the retired hook is
     still a pool this address owns. */
  const addresses = hooks.map((h) => h.address)
  const hookOf = (a: string): HookRef =>
    hooks.find((h) => h.address.toLowerCase() === a.toLowerCase()) ?? { address: getAddress(a), source: 'deployment' }
  if (addresses.length === 0) {
    const clock = await readContractClockReading(REVSHARE_CHAIN_ID)
    return {
      pools: [],
      transferredAway: 0,
      fromBlock,
      toBlock: clock.rpcBlockNumber,
      blockNumber: clock.rpcBlockNumber,
      contractBlockNumber: clock.contractBlockNumber,
      timestamp: clock.timestamp,
    }
  }

  /* WINDOWED, AND ALL THREE QUERIES SHARE ONE WALK. These were three
     `deployedAtBlock -> 'latest'` calls the endpoint refuses, which is why this
     screen never left "Reading contract logs…". Run through three separate
     `scanWindows` calls they would also put nine requests in flight against an
     endpoint sized for three; `scanWindowsMulti` keeps the budget the budget.

     Each callback reduces to the poolId inside the callback — the only field
     any of the three contributes — so viem's per-event inference survives and
     the three differently-shaped logs come back as one list of ids. */
  const toBlock = await c.getBlockNumber()
  const candidateIds = await scanWindowsMulti<string>(
    fromBlock,
    toBlock,
    [
      async (f, t) =>
        (await c.getLogs({ address: addresses, event: POOL_CLAIMED_EVENT, args: { owner }, fromBlock: f, toBlock: t }))
          .flatMap((l) => (l.args.poolId === undefined ? [] : [`${l.address.toLowerCase()}|${l.args.poolId}`])),
      async (f, t) =>
        (await c.getLogs({ address: addresses, event: POOL_OWNER_CHANGED_EVENT, args: { to: owner }, fromBlock: f, toBlock: t }))
          .flatMap((l) => (l.args.poolId === undefined ? [] : [`${l.address.toLowerCase()}|${l.args.poolId}`])),
      async (f, t) =>
        (await c.getLogs({ address: addresses, event: POOL_OWNER_CHANGED_EVENT, args: { from: owner }, fromBlock: f, toBlock: t }))
          .flatMap((l) => (l.args.poolId === undefined ? [] : [`${l.address.toLowerCase()}|${l.args.poolId}`])),
    ],
    'pools you own (PoolClaimed + PoolOwnerChanged)',
  )

  const candidates = new Set<string>(candidateIds)

  const pools: OwnedPool[] = []
  let transferredAway = 0

  for (const candidate of candidates) {
    const [hookAddress = '', rawId = ''] = candidate.split('|')
    const poolId = rawId as Hex
    const hookRef = hookOf(hookAddress)
    const hook = hookRef.address
    const read = <T,>(functionName: string, args: readonly unknown[]) =>
      c.readContract({
        address: hook,
        abi: REV_SHARE_HOOK_ABI,
        functionName: functionName as 'getConfig',
        args: args as never,
      }) as Promise<T>
    const current = await read<Address>('poolOwner', [poolId])
    if (current.toLowerCase() !== owner.toLowerCase()) {
      transferredAway += 1
      continue
    }
    const [config, distributorRaw, pending] = await Promise.all([
      read<PoolConfig>('getConfig', [poolId]),
      read<Address>('distributorOf', [poolId]),
      /* Raw, in the hook's own shape — see `readPendingConfig`. A throw fails the
         whole list rather than listing this pool as having no proposal. */
      readPendingConfig(c, REVSHARE_CHAIN_ID, hook, poolId),
    ])
    pools.push({
      hook: hookRef,
      poolId,
      config: {
        owner: config.owner,
        feePips: Number(config.feePips),
        lpDonateBps: Number(config.lpDonateBps),
        beneficiaryBps: Number(config.beneficiaryBps),
        distributorBps: Number(config.distributorBps),
        enabled: config.enabled,
        frozen: config.frozen,
      },
      distributor: distributorRaw === ZERO_ADDRESS ? null : distributorRaw,
      pendingEffective: pending.effective,
      pendingExpiry: pending.expiry,
      pendingDurationClock: pending.durationClock,
    })
  }

  /* Read AFTER the per-pool reads so no proposal can look older than the clock
     it is judged against. */
  const clock = await readContractClockReading(REVSHARE_CHAIN_ID)
  return {
    pools,
    transferredAway,
    fromBlock,
    toBlock,
    blockNumber: toBlock,
    contractBlockNumber: clock.contractBlockNumber,
    timestamp: clock.timestamp,
  }
}

/**
 * Just the distributor for a pool, without loading everything screen B loads.
 *
 * Returns `configured: false` on the same `owner == address(0)` test as
 * `readPoolOverview` — for the same reason: the zero struct is not a
 * configuration.
 */
export async function readDistributorFor(
  hook: Address,
  poolId: Hex,
): Promise<{ hasCode: boolean; answersAsHook: boolean; configured: boolean; distributor: Address | null }> {
  const c = client(REVSHARE_CHAIN_ID)
  const blank = { hasCode: false, answersAsHook: false, configured: false, distributor: null }
  const code = await c.getCode({ address: hook })
  if (!code || code.length <= 2) return blank

  let owner: Address
  try {
    owner = (await c.readContract({
      address: hook,
      abi: REV_SHARE_HOOK_ABI,
      functionName: 'poolOwner',
      args: [poolId],
    })) as Address
  } catch {
    return { ...blank, hasCode: true }
  }
  if (owner === ZERO_ADDRESS) {
    return { hasCode: true, answersAsHook: true, configured: false, distributor: null }
  }

  const distributor = (await c.readContract({
    address: hook,
    abi: REV_SHARE_HOOK_ABI,
    functionName: 'distributorOf',
    args: [poolId],
  })) as Address

  return {
    hasCode: true,
    answersAsHook: true,
    configured: true,
    distributor: distributor === ZERO_ADDRESS ? null : distributor,
  }
}

/* ---------------------------------------------------------------------------
   Distributors — constraint 4
   --------------------------------------------------------------------------- */

export type DistributorKind = 'snapshot' | 'merkle' | 'unknown'

export interface SnapshotEpoch {
  id: bigint
  amount0: bigint
  amount1: bigint
  claimed0: bigint
  claimed1: bigint
  totalVotingSupply: bigint
  timepoint: number
  closedAt: bigint
  expiresAt: bigint
  rolledOver: boolean
}

export interface MerkleEpoch {
  id: bigint
  amount0: bigint
  amount1: bigint
  claimed0: bigint
  claimed1: bigint
  root: Hex
  closedAt: bigint
  claimableAt: bigint
  /** 0 while no root stands (never posted, or cancelled). */
  expiresAt: bigint
  /**
   * `rolloverEligibleAt(id)` — when `rollover` stops reverting `NotExpiredYet`.
   * Equal to `expiresAt` once a root stands; for a rootless epoch it is the
   * abandonment fallback (or a later `cancelRoot` floor), which `getEpoch` does
   * not carry. Read from chain, never recomputed.
   */
  rolloverEligibleAt: bigint
  rolledOver: boolean
}

export interface DistributorCommon {
  address: Address
  minEpochDuration: bigint
  claimWindow: bigint
  epochCount: bigint
  lastCloseAt: bigint
  carryOver0: bigint
  carryOver1: bigint
  /** The distributor's own `poolKey()` — always present, it is in storage. */
  key: PoolKeyStruct
  token0: TokenMeta
  token1: TokenMeta
  /** Chain head timestamp, for every countdown on the screen. */
  now: bigint
}

export type DistributorState =
  | { kind: 'snapshot'; common: DistributorCommon; token: TokenMeta; clockIsBlockNumber: boolean; epochs: SnapshotEpoch[] }
  | { kind: 'merkle'; common: DistributorCommon; challengeDelay: bigint; guardian: Address; epochs: MerkleEpoch[] }
  | { kind: 'unknown'; address: Address }

/**
 * Map a `kind()` return value onto a distributor. Exact match only. Zero, an
 * unrecognised hash, or a value of the wrong width are all 'unknown'. Mirrors
 * `kindFromBytes32` in `packages/keeper/src/decode.ts`.
 */
export function kindFromBytes32(value: unknown): DistributorKind {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) return 'unknown'
  const v = value.toLowerCase()
  if (v === DISTRIBUTOR_KIND.snapshot.toLowerCase()) return 'snapshot'
  if (v === DISTRIBUTOR_KIND.merkle.toLowerCase()) return 'merkle'
  return 'unknown'
}

/**
 * Which distributor is this? Ask it.
 *
 * Both distributors implement `IEpochDistributor.kind()`, which returns one of
 * two domain-separated constants. Anything else — a revert, empty return data,
 * zero, an unrecognised hash — is 'unknown', and 'unknown' is rendered as "not
 * a distributor this build understands". It is never guessed into a type,
 * because decoding the wrong nine-field epoch struct produces plausible numbers
 * that mean nothing, and it never falls back to probing `token()` /
 * `challengeDelay()`: any contract with a `token()` getter passed that probe.
 * A distributor deployed before `kind()` existed reads as 'unknown' too, which
 * is the honest answer.
 *
 * Only a verdict ABOUT THE ADDRESS becomes 'unknown': a revert, no return data,
 * or return data too short to be a bytes32. A transport failure THROWS, so the
 * screen renders "chain unreachable" rather than "not a distributor" — the
 * RPC not answering is not evidence about the contract.
 */
export async function probeDistributor(address: Address): Promise<DistributorKind> {
  const c = client(REVSHARE_CHAIN_ID)
  let raw: unknown
  try {
    raw = await c.readContract({ address, abi: DISTRIBUTOR_KIND_ABI, functionName: 'kind' })
  } catch (e) {
    const aboutTheAddress =
      e instanceof BaseError &&
      Boolean(
        e.walk(
          (x) =>
            x instanceof ContractFunctionRevertedError ||
            x instanceof ContractFunctionZeroDataError ||
            x instanceof ExecutionRevertedError ||
            x instanceof AbiDecodingZeroDataError ||
            x instanceof AbiDecodingDataSizeTooSmallError,
        ),
      )
    if (aboutTheAddress) return 'unknown'
    throw e
  }
  return kindFromBytes32(raw)
}

/** Newest epochs first, capped — an epoch list is unbounded on chain. */
const MAX_EPOCHS_SHOWN = 24

export async function readDistributor(address: Address): Promise<DistributorState> {
  const kind = await probeDistributor(address)
  if (kind === 'unknown') return { kind: 'unknown', address }

  const c = client(REVSHARE_CHAIN_ID)
  const abi = (kind === 'snapshot' ? SNAPSHOT_DISTRIBUTOR_ABI : MERKLE_DISTRIBUTOR_ABI) as Abi
  const read = <T,>(functionName: string, args: readonly unknown[] = []) =>
    c.readContract({ address, abi, functionName, args }) as Promise<T>

  const [minEpochDuration, claimWindow, epochCount, lastCloseAt, carryOver0, carryOver1, rawKey, block] =
    await Promise.all([
      read<bigint>('minEpochDuration'),
      read<bigint>('claimWindow'),
      read<bigint>('epochCount'),
      read<bigint>('lastCloseAt'),
      read<bigint>('carryOver0'),
      read<bigint>('carryOver1'),
      read<PoolKeyStruct>('poolKey'),
      c.getBlock(),
    ])

  const key: PoolKeyStruct = {
    currency0: rawKey.currency0,
    currency1: rawKey.currency1,
    hooks: rawKey.hooks,
    poolManager: rawKey.poolManager,
    fee: Number(rawKey.fee),
    parameters: rawKey.parameters,
  }

  const [token0, token1] = await Promise.all([readToken(key.currency0), readToken(key.currency1)])

  const common: DistributorCommon = {
    address,
    minEpochDuration: BigInt(minEpochDuration),
    claimWindow: BigInt(claimWindow),
    epochCount: BigInt(epochCount),
    lastCloseAt: BigInt(lastCloseAt),
    carryOver0,
    carryOver1,
    key,
    token0,
    token1,
    now: block.timestamp,
  }

  const first = epochCount > BigInt(MAX_EPOCHS_SHOWN) ? epochCount - BigInt(MAX_EPOCHS_SHOWN) : 0n
  const ids: bigint[] = []
  for (let id = epochCount - 1n; id >= first && id >= 0n; id--) ids.push(id)

  if (kind === 'snapshot') {
    const [tokenAddr, clockIsBlockNumber] = await Promise.all([
      read<Address>('token'),
      read<boolean>('clockIsBlockNumber'),
    ])
    const epochs = await Promise.all(
      ids.map(async (id) => {
        const e = await read<SnapshotEpoch>('getEpoch', [id])
        return {
          id,
          amount0: e.amount0,
          amount1: e.amount1,
          claimed0: e.claimed0,
          claimed1: e.claimed1,
          totalVotingSupply: e.totalVotingSupply,
          timepoint: Number(e.timepoint),
          closedAt: BigInt(e.closedAt),
          expiresAt: BigInt(e.expiresAt),
          rolledOver: e.rolledOver,
        }
      }),
    )
    return { kind: 'snapshot', common, token: await readToken(tokenAddr), clockIsBlockNumber, epochs }
  }

  const [challengeDelay, guardian] = await Promise.all([read<bigint>('challengeDelay'), read<Address>('guardian')])
  const epochs = await Promise.all(
    ids.map(async (id) => {
      /* `rolloverEligibleAt` is read for MERKLE epochs only, exactly as the
         keeper's rollover job does. Without it a rootless epoch
         (`expiresAt == 0`) could never be offered for rollover — or, gated on
         `expiresAt` alone, would look due the moment it closed. */
      const [e, eligibleAt] = await Promise.all([
        read<Omit<MerkleEpoch, 'id' | 'rolloverEligibleAt'>>('getEpoch', [id]),
        read<bigint | number>('rolloverEligibleAt', [id]),
      ])
      return {
        id,
        amount0: e.amount0,
        amount1: e.amount1,
        claimed0: e.claimed0,
        claimed1: e.claimed1,
        root: e.root,
        closedAt: BigInt(e.closedAt),
        claimableAt: BigInt(e.claimableAt),
        expiresAt: BigInt(e.expiresAt),
        rolloverEligibleAt: BigInt(eligibleAt),
        rolledOver: e.rolledOver,
      }
    }),
  )
  return { kind: 'merkle', common, challengeDelay: BigInt(challengeDelay), guardian, epochs }
}

/** What a holder would get from one snapshot epoch, and whether they took it. */
export interface EpochStanding {
  epochId: bigint
  amount0: bigint
  amount1: bigint
  claimed: boolean
}

export async function readSnapshotStandings(
  distributor: Address,
  account: Address,
  epochIds: readonly bigint[],
): Promise<EpochStanding[]> {
  const c = client(REVSHARE_CHAIN_ID)
  return Promise.all(
    epochIds.map(async (epochId) => {
      const [amounts, claimed] = await Promise.all([
        c.readContract({
          address: distributor,
          abi: SNAPSHOT_DISTRIBUTOR_ABI,
          functionName: 'claimableAmounts',
          args: [epochId, account],
        }),
        c.readContract({
          address: distributor,
          abi: SNAPSHOT_DISTRIBUTOR_ABI,
          functionName: 'claimed',
          args: [epochId, account],
        }),
      ])
      return { epochId, amount0: amounts[0], amount1: amounts[1], claimed }
    }),
  )
}

/* ---------------------------------------------------------------------------
   Screen D — the global claimable balance, constraint 3
   --------------------------------------------------------------------------- */

export interface ClaimableRow {
  token: TokenMeta
  amount: bigint
  /** `backing(currency)` — what the hook could actually pay out right now. */
  backing: bigint
  /** `totalOwed(currency)` — what it owes every recipient combined. */
  totalOwed: bigint
}

/**
 * Currencies this hook has ever paid revenue in, across ALL pools.
 *
 * There is no registry of currencies on the hook, so this is the log stream
 * again — and like every log-derived list on these screens it is bounded by
 * the scanned window. It exists so the claim screen has somewhere to start;
 * a currency it misses can still be checked by pasting its address.
 */
export async function readCurrenciesSeen(
  hook: Address,
): Promise<{ tokens: TokenMeta[]; fromBlock: bigint; toBlock: bigint }> {
  const c = client(REVSHARE_CHAIN_ID)
  const fromBlock = DEPLOYMENTS[REVSHARE_CHAIN_ID].deployedAtBlock

  /* WINDOWED. The unwindowed version was refused, and the claim screen has no
     other way to discover which currencies a hook has ever paid in, so it never
     rendered a balance at all.

     Exhaustive rather than backward-limited: a currency that accrued once, long
     ago, and never again is exactly the balance a holder would otherwise never
     be shown. If the scan cannot complete this THROWS — an empty token list
     would read as "you are owed nothing", which is a claim about the holder's
     money that nobody made. */
  const toBlock = await c.getBlockNumber()
  const logs = await scanWindows(
    fromBlock,
    toBlock,
    (from, to) => c.getLogs({ address: hook, event: REV_SHARE_TAKEN_EVENT, fromBlock: from, toBlock: to }),
    'currencies this hook has paid in (RevShareTaken)',
  )

  const seen = new Map<string, Address>()
  for (const l of logs) {
    const currency = l.args.currency
    if (currency) seen.set(currency.toLowerCase(), currency)
  }
  const tokens = await Promise.all([...seen.values()].map(readToken))
  return { tokens, fromBlock, toBlock }
}

export interface HookClaimable {
  hook: HookRef
  rows: ClaimableRow[]
  /** Currencies this hook's RevShareTaken logs named (before any pasted token). */
  discovered: number
}

/**
 * `claimable` for `recipient` on EVERY hook, current and retired.
 *
 * A balance is keyed by hook as well as by currency: the retired 0x23CE… holds
 * its own `claimable` mapping, and a beneficiary paid there is paid there
 * forever. Reading only the current hook showed "no currency to check" to an
 * address holding a real balance on the retired one. One `getLogs` per scan
 * covers every hook (address list), and `l.address` attributes each currency.
 */
export async function readClaimableAcross(
  hooks: readonly HookRef[],
  recipient: Address,
  extra: Address | null,
): Promise<{ perHook: HookClaimable[]; fromBlock: bigint; toBlock: bigint }> {
  const c = client(REVSHARE_CHAIN_ID)
  const fromBlock = DEPLOYMENTS[REVSHARE_CHAIN_ID].deployedAtBlock
  const toBlock = await c.getBlockNumber()
  if (hooks.length === 0) return { perHook: [], fromBlock, toBlock }

  const seen = await scanWindows(
    fromBlock,
    toBlock,
    async (from, to) =>
      (
        await c.getLogs({
          address: hooks.map((h) => h.address),
          event: REV_SHARE_TAKEN_EVENT,
          fromBlock: from,
          toBlock: to,
        })
      ).flatMap((l) => (l.args.currency ? [{ hook: l.address.toLowerCase(), currency: l.args.currency }] : [])),
    'currencies each hook has paid in (RevShareTaken)',
  )

  const perHook = await Promise.all(
    hooks.map(async (hook): Promise<HookClaimable> => {
      const currencies = new Map<string, Address>()
      for (const x of seen) {
        if (x.hook === hook.address.toLowerCase()) currencies.set(x.currency.toLowerCase(), x.currency)
      }
      const discovered = currencies.size
      if (extra) currencies.set(extra.toLowerCase(), extra)
      const tokens = await Promise.all([...currencies.values()].map(readToken))
      return { hook, rows: await readGlobalClaimable(hook.address, recipient, tokens), discovered }
    }),
  )
  return { perHook, fromBlock, toBlock }
}

/**
 * `claimable(recipient, currency)` — GLOBAL, not per pool.
 *
 * The mapping is `recipient => currency => amount`. A recipient on the roster
 * of three pools has one balance covering all three, and `claim(currency, to)`
 * withdraws the whole thing. Nothing on chain can attribute a slice of it to a
 * particular pool, so the UI must not offer a per-pool figure.
 */
export async function readGlobalClaimable(
  hook: Address,
  recipient: Address,
  tokens: readonly TokenMeta[],
): Promise<ClaimableRow[]> {
  const c = client(REVSHARE_CHAIN_ID)
  return Promise.all(
    tokens.map(async (token) => {
      const [amount, backing, totalOwed] = await Promise.all([
        c.readContract({
          address: hook,
          abi: REV_SHARE_HOOK_ABI,
          functionName: 'claimable',
          args: [recipient, token.address],
        }),
        c.readContract({
          address: hook,
          abi: REV_SHARE_HOOK_ABI,
          functionName: 'backing',
          args: [token.address],
        }),
        c.readContract({
          address: hook,
          abi: REV_SHARE_HOOK_ABI,
          functionName: 'totalOwed',
          args: [token.address],
        }),
      ])
      return { token, amount, backing, totalOwed }
    }),
  )
}

/* ---------------------------------------------------------------------------
   Failure decoding — the house pattern, from lib/registryWrite.ts
   --------------------------------------------------------------------------- */

export type FailureKind = 'rejected' | 'contract' | 'chain'

export interface DecodedFailure {
  kind: FailureKind
  /** The Solidity custom error name, when the revert carried one we know. */
  name: string | null
  message: string
  /** The raw error, so nothing the chain said is hidden. */
  detail: string
}

/**
 * Plain-English copy for the reverts these screens can actually provoke.
 *
 * Every write on this surface is permissionless, which means every contract
 * defends itself by reverting at the wrong moment — `EpochTooSoon`,
 * `AlreadyRolledOver`, `NothingToClaim` are the NORMAL answer most of the
 * time, not a bug. So they are phrased as states, not as failures.
 */
const ERROR_COPY: Record<string, (args: readonly unknown[]) => string> = {
  EpochTooSoon: ([earliest]) =>
    `The distributor will not close an epoch yet — the minimum epoch duration runs until unix ${String(earliest)}.`,
  NothingToDistribute: () =>
    'There is nothing in the pot to close an epoch over. Fees have to reach the distributor first: ' +
    'the pool must be taking a cut, and the distributor must have pulled its share.',
  NoVotingSupplyAtSnapshot: ([timepoint]) =>
    `No voting supply existed at timepoint ${String(timepoint)}, so a pro-rata split is undefined. ` +
    'The token needs delegated votes before an epoch can close.',
  UnknownEpoch: ([id]) => `Epoch ${String(id)} does not exist on this distributor.`,
  AlreadyRolledOver: ([id]) => `Epoch ${String(id)} has already been rolled over. Nothing further to do.`,
  /* The second argument is the deadline that governs, which on the merkle
     distributor is the abandonment fallback for an epoch with no root — not a
     claim window. Worded so it is true of both. */
  NotExpiredYet: ([id, eligibleAt]) =>
    `Epoch ${String(id)} cannot be rolled over until unix ${String(eligibleAt)}.`,
  ClaimWindowClosed: (args) =>
    `The claim window for epoch ${String(args[0])} closed at unix ${String(args[1])}. ` +
    'Whatever was left returns to the next epoch through `rollover`.',
  ClaimNotOpenYet: (args) =>
    `Epoch ${String(args[0])} is inside its challenge period until unix ${String(args[1])}.`,
  AlreadyClaimed: (args) =>
    `Epoch ${String(args[0])} has already been claimed for ${String(args[1])}.`,
  NothingToClaim: (args) =>
    args.length === 0
      ? 'This address has no settled balance in that currency. `claim` reverts rather than sending an empty transfer.'
      : `${String(args[1])} held no delegated votes at epoch ${String(args[0])}'s snapshot, so its share is zero.`,
  NoPendingConfig: () => 'There is no config proposal outstanding for this pool.',
  PendingConfigNotDue: (args) =>
    `The proposal for this pool does not become applicable until block ${String(args[1])}.`,
  PendingConfigExpired: (args) =>
    `The proposal for this pool expired after block ${String(args[1])} and can no longer be applied. ` +
    'The owner would have to propose it again and wait out the full delay.',
  PoolNotConfigured: () => 'This pool has never been configured on this hook.',
  HookMismatch: ([declared]) =>
    `The pool key names ${String(declared)} as its hook, which is not this contract. The key is wrong.`,
  PoolManagerMismatch: ([declared]) =>
    `The pool key names ${String(declared)} as its pool manager; this hook serves a different one.`,
  InsufficientBackedBalance: (args) =>
    `The hook cannot cover this payout in ${String(args[0])}: ${String(args[1])} needed, ${String(args[2])} available.`,
  InvalidRecipient: () => 'The recipient cannot be the zero address.',

  /* Owner-gated calls. These reach the UI only from `PoolOwnerActions`, and
     each one is a state the owner can act on, so say what to change. */
  NotPoolOwner: (args) =>
    `${String(args[1])} does not own this pool, so the hook refuses the call. ` +
    'Connect the owner address shown in the configuration card above.',
  ConfigFrozen: () =>
    'This pool is frozen. `freezeConfig` is one-way and permanent — the fee, the split and the ' +
    'roster can never change again, by anyone, including the owner.',
  PoolAlreadyConfigured: () =>
    'The pool is already initialised, so it cannot be reconfigured in place. Raising the take goes ' +
    'through `proposeConfig` and the block delay; lowering it goes through `reduceFee` immediately.',
  FeeTooHigh: ([feePips]) =>
    `${String(feePips)} pips exceeds MAX_FEE_PIPS (100000 = 10%). The cap is a constant and cannot be raised.`,
  SplitMustSumToDenominator: ([sum]) =>
    `The three split weights sum to ${String(sum)}, not 10000. The check is exact, not a ceiling — ` +
    'a split summing to less would quietly shrink the cut rather than erroring.',
  DistributorRequired: () =>
    'A non-zero distributor share needs a distributor address. Either set the address or move that ' +
    'share to the LPs or the roster.',
  FeeNotReduced: (args) =>
    `\`reduceFee\` only ever lowers the take: it is at ${String(args[0])} pips and ${String(args[1])} ` +
    'is not below that. An increase must go through `proposeConfig` and wait out the delay.',
  InvalidBeneficiaries: () =>
    'The roster was rejected. Every entry needs a non-zero address and a non-zero weight, there can ' +
    'be at most 8 entries, and the weights must sum to at most 1e18.',
  PoolMustUseStaticFee: () =>
    'This hook refuses pools with a dynamic LP fee — it never overrides the fee, so a pool whose fee ' +
    'can move underneath it cannot be served honestly.',
}

export function decodeRevShareFailure(error: unknown): DecodedFailure | null {
  if (!error) return null

  const detail = error instanceof BaseError ? error.shortMessage : String(error)

  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return {
        kind: 'rejected',
        name: 'UserRejectedRequest',
        message: 'You rejected the request in your wallet. Nothing was signed and nothing was submitted.',
        detail,
      }
    }

    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? null
      const args = reverted.data?.args ?? []
      const copy = name ? ERROR_COPY[name] : undefined
      if (name && copy) return { kind: 'contract', name, message: copy(args), detail }
      if (name) {
        return {
          kind: 'contract',
          name,
          message: `The contract reverted with ${name}(${args.map(String).join(', ')}).`,
          detail,
        }
      }
      return {
        kind: 'contract',
        name: null,
        message:
          reverted.reason ?? 'The contract reverted without a reason this build can decode. The raw error is below.',
        detail,
      }
    }
  }

  return {
    kind: 'chain',
    name: null,
    message:
      'The call could not be completed — the RPC did not answer, or it failed before reaching the contract. ' +
      'This is not a verdict on the transaction.',
    detail,
  }
}

/* ---------------------------------------------------------------------------
   Small formatters shared by the four screens
   --------------------------------------------------------------------------- */

export function addressEquals(a: string | undefined | null, b: string | undefined | null): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

export function shortHex(value: string, lead = 6, tail = 4): string {
  return value.length > lead + tail + 2 ? `${value.slice(0, lead)}…${value.slice(-tail)}` : value
}

/** A duration in seconds, as a person reads it. Never rounded to "0s". */
export function fmtDuration(seconds: bigint): string {
  const n = Number(seconds < 0n ? -seconds : seconds)
  if (n < 60) return `${n}s`
  if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`
  if (n < 86400) return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`
  return `${Math.floor(n / 86400)}d ${Math.floor((n % 86400) / 3600)}h`
}

/** A unix seconds timestamp as an ISO-ish UTC string. 0 renders as "never". */
export function fmtTimestamp(seconds: bigint): string {
  if (seconds === 0n) return 'never'
  return `${new Date(Number(seconds) * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`
}

export function explorer(path: string): string {
  return `${DEPLOYMENTS[REVSHARE_CHAIN_ID].explorer}/${path}`
}
