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
      calldata. `resolvePoolKey` below finds the key in one of the two places
      it is actually recorded — a distributor's `poolKey()`, or the CL pool
      manager's `Initialize` log — and returns null when neither answers. A
      null there disables the write buttons and says why; it never produces a
      guessed key.

   2. THERE ARE NO CUMULATIVE COUNTERS. `RevShareHook` has no
      `totalTaken(poolId, currency)`. The only record of what a pool has ever
      taken is the `RevShareTaken` log stream, so `readLifetime` sums logs and
      returns the block range it summed — which the UI must print. It is a
      total over a scanned window, and the window is bounded by what the RPC
      will serve.

   3. `claimable` IS KEYED (recipient, currency) GLOBALLY. Not per pool. A
      beneficiary of two pools has ONE balance, and `claim(currency, to)` pays
      all of it. No view function can decompose it, so nothing here pretends
      to — see `readGlobalClaimable`.

   4. THERE IS NO DISTRIBUTOR TYPE DISCOVERY. `distributorOf` returns a bare
      address. `probeDistributor` calls `token()` (only Snapshot has it) and
      `challengeDelay()` (only Merkle has it) and reports 'unknown' when
      neither answers, rather than defaulting to a type.

   5. MERKLE PROOFS HAVE NO ON-CHAIN PUBLICATION CHANNEL. Nothing here can
      build a `MerkleEpochDistributor.claim` call, and no function that tries
      exists in this file.
   ============================================================================ */

import {
  BaseError,
  ContractFunctionRevertedError,
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
  type DeployedChainId,
} from '../../../lib/chain'
import {
  CL_INITIALIZE_EVENT,
  ERC20_META_ABI,
  MERKLE_DISTRIBUTOR_ABI,
  POOL_CLAIMED_EVENT,
  POOL_OWNER_CHANGED_EVENT,
  REV_SHARE_HOOK_ABI,
  REV_SHARE_TAKEN_EVENT,
  SNAPSHOT_DISTRIBUTOR_ABI,
} from './revshareAbi'

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
  source: 'url' | 'build' | 'deployment'
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
  const trimmed = urlParam?.trim() ?? ''
  if (trimmed !== '' && isAddress(trimmed, { strict: false })) {
    return { address: getAddress(trimmed), source: 'url' }
  }
  if (ENV_HOOK) return { address: ENV_HOOK, source: 'build' }
  if (DEPLOYED_HOOK) return { address: DEPLOYED_HOOK, source: 'deployment' }
  return null
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
  via: 'distributor.poolKey()' | 'CLPoolManager.Initialize log'
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

  const fromBlock = DEPLOYMENTS[REVSHARE_CHAIN_ID].deployedAtBlock
  const logs = await c.getLogs({
    address: poolManager,
    event: CL_INITIALIZE_EVENT,
    args: { id: poolId },
    fromBlock,
    toBlock: 'latest',
  })

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

export interface PendingConfig {
  /** 0 means no proposal outstanding. */
  effectiveBlock: bigint
  params: ConfigParams
}

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
 * This is an approximation over a scanned window, and every caller must label
 * it as one. There is no `totalTaken` on the hook; if the RPC's log retention
 * does not reach `deployedAtBlock`, earlier swaps are simply not counted and
 * nothing on chain can tell us how much was missed.
 */
export async function readLifetime(hook: Address, poolId: Hex): Promise<Lifetime> {
  const c = client(REVSHARE_CHAIN_ID)
  const fromBlock = DEPLOYMENTS[REVSHARE_CHAIN_ID].deployedAtBlock

  const [logs, toBlock] = await Promise.all([
    c.getLogs({
      address: hook,
      event: REV_SHARE_TAKEN_EVENT,
      args: { poolId },
      fromBlock,
      toBlock: 'latest',
    }),
    c.getBlockNumber(),
  ])

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
  configDelayBlocks: bigint
  blockNumber: bigint
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

  const [rawPending, rawBeneficiaries, totalWeight, distributorRaw, pendingOwnerRaw, paused, delay, blockNumber, poolManager] =
    await Promise.all([
      read<PendingConfig>('getPendingConfig', [poolId]),
      read<readonly Beneficiary[]>('getBeneficiaries', [poolId]),
      read<bigint>('totalWeight', [poolId]),
      read<Address>('distributorOf', [poolId]),
      read<Address>('pendingPoolOwner', [poolId]),
      read<boolean>('paused', []),
      read<bigint>('CONFIG_DELAY_BLOCKS', []),
      c.getBlockNumber(),
      read<Address>('poolManager', []),
    ])

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
      pending: {
        effectiveBlock: BigInt(rawPending.effectiveBlock),
        params: {
          feePips: Number(rawPending.params.feePips),
          lpDonateBps: Number(rawPending.params.lpDonateBps),
          beneficiaryBps: Number(rawPending.params.beneficiaryBps),
          distributorBps: Number(rawPending.params.distributorBps),
          distributor: rawPending.params.distributor,
          enabled: rawPending.params.enabled,
        },
      },
      beneficiaries: rawBeneficiaries.map((b) => ({ recipient: b.recipient, weight: BigInt(b.weight) })),
      totalWeight,
      distributor,
      pendingOwner: pendingOwnerRaw === ZERO_ADDRESS ? null : pendingOwnerRaw,
      paused,
      configDelayBlocks: BigInt(delay),
      blockNumber,
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
  poolId: Hex
  config: PoolConfig
  distributor: Address | null
  /** `getPendingConfig().effectiveBlock`; 0 when nothing is proposed. */
  pendingEffectiveBlock: bigint
}

export interface OwnedPools {
  pools: OwnedPool[]
  /** Ids seen in the logs whose current `poolOwner` is someone else. */
  transferredAway: number
  fromBlock: bigint
  toBlock: bigint
  blockNumber: bigint
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
export async function readOwnedPools(hook: Address, owner: Address): Promise<OwnedPools> {
  const c = client(REVSHARE_CHAIN_ID)
  const fromBlock = DEPLOYMENTS[REVSHARE_CHAIN_ID].deployedAtBlock

  const [claimed, gained, lost, toBlock] = await Promise.all([
    c.getLogs({ address: hook, event: POOL_CLAIMED_EVENT, args: { owner }, fromBlock, toBlock: 'latest' }),
    c.getLogs({ address: hook, event: POOL_OWNER_CHANGED_EVENT, args: { to: owner }, fromBlock, toBlock: 'latest' }),
    c.getLogs({ address: hook, event: POOL_OWNER_CHANGED_EVENT, args: { from: owner }, fromBlock, toBlock: 'latest' }),
    c.getBlockNumber(),
  ])

  const candidates = new Set<Hex>()
  for (const l of [...claimed, ...gained, ...lost]) {
    const id = l.args.poolId
    if (id) candidates.add(id)
  }

  const read = <T,>(functionName: string, args: readonly unknown[]) =>
    c.readContract({
      address: hook,
      abi: REV_SHARE_HOOK_ABI,
      functionName: functionName as 'getConfig',
      args: args as never,
    }) as Promise<T>

  const pools: OwnedPool[] = []
  let transferredAway = 0

  for (const poolId of candidates) {
    const current = await read<Address>('poolOwner', [poolId])
    if (current.toLowerCase() !== owner.toLowerCase()) {
      transferredAway += 1
      continue
    }
    const [config, distributorRaw, pending] = await Promise.all([
      read<PoolConfig>('getConfig', [poolId]),
      read<Address>('distributorOf', [poolId]),
      read<PendingConfig>('getPendingConfig', [poolId]),
    ])
    pools.push({
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
      pendingEffectiveBlock: BigInt(pending.effectiveBlock),
    })
  }

  return { pools, transferredAway, fromBlock, toBlock, blockNumber: toBlock }
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
  expiresAt: bigint
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
 * Which distributor is this?
 *
 * There is no `kind()` and the two contracts share no interface, so the probe
 * is by selector: `token()` exists only on the snapshot distributor,
 * `challengeDelay()` only on the merkle one. Both failing means the address is
 * not one of ours, and 'unknown' is reported as such — never guessed into a
 * type, because decoding the wrong nine-field epoch struct produces plausible
 * numbers that mean nothing.
 */
export async function probeDistributor(address: Address): Promise<DistributorKind> {
  const c = client(REVSHARE_CHAIN_ID)
  const [token, delay] = await Promise.all([
    c.readContract({ address, abi: SNAPSHOT_DISTRIBUTOR_ABI, functionName: 'token' }).catch(() => null),
    c.readContract({ address, abi: MERKLE_DISTRIBUTOR_ABI, functionName: 'challengeDelay' }).catch(() => null),
  ])
  if (token !== null && delay === null) return 'snapshot'
  if (delay !== null && token === null) return 'merkle'
  return 'unknown'
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
      const e = await read<MerkleEpoch>('getEpoch', [id])
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
export async function readCurrenciesSeen(hook: Address): Promise<{ tokens: TokenMeta[]; fromBlock: bigint }> {
  const c = client(REVSHARE_CHAIN_ID)
  const fromBlock = DEPLOYMENTS[REVSHARE_CHAIN_ID].deployedAtBlock
  const logs = await c.getLogs({ address: hook, event: REV_SHARE_TAKEN_EVENT, fromBlock, toBlock: 'latest' })

  const seen = new Map<string, Address>()
  for (const l of logs) {
    const currency = l.args.currency
    if (currency) seen.set(currency.toLowerCase(), currency)
  }
  const tokens = await Promise.all([...seen.values()].map(readToken))
  return { tokens, fromBlock }
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
  NotExpiredYet: ([id, expiresAt]) =>
    `Epoch ${String(id)} is still claimable until unix ${String(expiresAt)}; it cannot be rolled over before then.`,
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
