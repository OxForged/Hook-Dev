/* ============================================================================
   Governance — live reads for the Safe, the two LatchTimelocks, ownership of
   every Ownable contract in DEPLOYMENTS, and queued timelock operations.

   Every value here is read from chain. `ops/safe/robinhood-deployment.md` is
   the factual record of what was deployed and by whom, but ownership is
   mid-migration on Robinhood — the Safe -> timelock handover is queued, not
   finished — so a hardcoded answer copied from that file would be wrong within
   hours. Nothing here is copied from it; the file is background reading only.

   THE ONE ADDRESS THAT IS HARDCODED. `SAFE_ADDRESS` is not a live reading — it
   is an identifier, the same kind of constant `DEPLOYMENTS` already carries
   for every other contract. It is deployed at the SAME address on Robinhood
   and Sepolia (see CLAUDE.md "The governance Safe"), and every FIGURE about it
   — threshold, owners, nonce — is still read live below, never assumed.

   OWNERSHIP RESOLUTION FOLLOWS owner() HOPS, NOT A GUESS. `CLPoolManager` and
   `BinPoolManager` are owned by `*PoolManagerOwner` wrapper contracts, whose
   addresses are NOT in DEPLOYMENTS. Rather than hardcode them from the ops
   doc, `followOwnerChain` reads owner() on the tracked contract, then keeps
   reading owner() on whatever it finds until it lands on the Safe, a known
   timelock, or an address with no further owner() to call (an EOA, or a
   contract — Safe included — that does not implement Ownable). Every hop in
   the chain is a real on-chain read.
   ============================================================================ */

import { parseAbi, zeroAddress, type Address, type Hex } from 'viem'
import { client, DEPLOYMENTS, scanWindowsMulti, type DeployedChainId } from '../../../lib/chain'

/** Deployed identically on Robinhood Chain (4663) and Ethereum Sepolia — see
 *  CLAUDE.md "The governance Safe". On Robinhood it owns every contract in the
 *  table below; on Sepolia it exists but owns nothing there (the deployer EOA
 *  still does). Which is true for a given chain is read, not assumed here. */
export const SAFE_ADDRESS: Address = '0x715a6176946aDbD22c1B2021d321Fb3767ca3432'

/* --------------------------------------------------------------------------
   ABIs — only what is read.
   -------------------------------------------------------------------------- */

const SAFE_ABI = parseAbi([
  'function getThreshold() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function nonce() view returns (uint256)',
])

const OWNABLE_ABI = parseAbi([
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
])

/** Matches LatchTimelock (packages/governance/src/LatchTimelock.sol), which
 *  extends OZ's TimelockController + AccessControl. Role hashes are read from
 *  the contract rather than computed locally, so a role name never has to be
 *  trusted against a hardcoded keccak256. */
const TIMELOCK_ABI = parseAbi([
  'function getMinDelay() view returns (uint256)',
  'function minDelayFloor() view returns (uint256)',
  'function PROPOSER_ROLE() view returns (bytes32)',
  'function EXECUTOR_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function isOperationPending(bytes32 id) view returns (bool)',
  'function isOperationReady(bytes32 id) view returns (bool)',
  'function isOperationDone(bytes32 id) view returns (bool)',
  'function getTimestamp(bytes32 id) view returns (uint256)',
])

const CALL_SCHEDULED_EVENT = parseAbi([
  'event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)',
])

/* --------------------------------------------------------------------------
   The Safe
   -------------------------------------------------------------------------- */

export interface SafeStatus {
  chainId: DeployedChainId
  address: Address
  threshold: number
  owners: readonly Address[]
  nonce: bigint
}

export async function readSafeStatus(chainId: DeployedChainId): Promise<SafeStatus> {
  const c = client(chainId)
  const [threshold, owners, nonce] = await Promise.all([
    c.readContract({ address: SAFE_ADDRESS, abi: SAFE_ABI, functionName: 'getThreshold' }),
    c.readContract({ address: SAFE_ADDRESS, abi: SAFE_ABI, functionName: 'getOwners' }),
    c.readContract({ address: SAFE_ADDRESS, abi: SAFE_ABI, functionName: 'nonce' }),
  ])
  return { chainId, address: SAFE_ADDRESS, threshold: Number(threshold), owners, nonce }
}

/* --------------------------------------------------------------------------
   The two timelocks
   -------------------------------------------------------------------------- */

export type TimelockTier = 'Custody' | 'Policy'

export interface TimelockStatus {
  chainId: DeployedChainId
  address: Address
  tier: TimelockTier
  minDelaySec: bigint
  minDelayFloorSec: bigint
  /** hasRole(PROPOSER_ROLE, SAFE_ADDRESS). AccessControl has no member list, so
   *  this checks the one address the deployment record names as proposer — it
   *  is not proof the Safe is the ONLY proposer. */
  safeIsProposer: boolean
  /** hasRole(EXECUTOR_ROLE, address(0)) — true makes execution permissionless. */
  executionOpen: boolean
  /** OZ's TimelockController unconditionally self-grants DEFAULT_ADMIN_ROLE to
   *  the timelock's own address on deploy (self-administration: it can only
   *  change its own roles through a queued call to itself). LatchTimelock
   *  passes address(0) as the optional external admin, so no outside address
   *  should ever hold it. `selfAdmin` is expected true; `safeHasAdmin` and
   *  `zeroHasAdmin` are expected false — either being true would be a
   *  permanent backdoor around every delay this contract enforces. */
  selfAdmin: boolean
  safeHasAdmin: boolean
  zeroHasAdmin: boolean
}

export async function readTimelockStatus(
  chainId: DeployedChainId,
  address: Address,
  tier: TimelockTier,
): Promise<TimelockStatus> {
  const c = client(chainId)
  const [minDelaySec, minDelayFloorSec, proposerRole, executorRole, adminRole] = await Promise.all([
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'getMinDelay' }),
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'minDelayFloor' }),
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'PROPOSER_ROLE' }),
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'EXECUTOR_ROLE' }),
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'DEFAULT_ADMIN_ROLE' }),
  ])

  const [safeIsProposer, executionOpen, selfAdmin, safeHasAdmin, zeroHasAdmin] = await Promise.all([
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'hasRole', args: [proposerRole, SAFE_ADDRESS] }),
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'hasRole', args: [executorRole, zeroAddress] }),
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'hasRole', args: [adminRole, address] }),
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'hasRole', args: [adminRole, SAFE_ADDRESS] }),
    c.readContract({ address, abi: TIMELOCK_ABI, functionName: 'hasRole', args: [adminRole, zeroAddress] }),
  ])

  return {
    chainId,
    address,
    tier,
    minDelaySec,
    minDelayFloorSec,
    safeIsProposer,
    executionOpen,
    selfAdmin,
    safeHasAdmin,
    zeroHasAdmin,
  }
}

/* --------------------------------------------------------------------------
   Ownership table
   -------------------------------------------------------------------------- */

export type OwnerKind = 'safe' | 'custody-timelock' | 'policy-timelock' | 'eoa' | 'contract'

export interface ResolvedOwner {
  address: Address
  kind: OwnerKind
  label: string
}

async function resolveOwnerName(chainId: DeployedChainId, address: Address): Promise<ResolvedOwner> {
  const d = DEPLOYMENTS[chainId]
  const lower = address.toLowerCase()
  if (lower === SAFE_ADDRESS.toLowerCase()) return { address, kind: 'safe', label: 'Safe' }
  if (lower === d.timelockCustody.toLowerCase()) {
    return { address, kind: 'custody-timelock', label: 'Custody timelock (48h)' }
  }
  if (lower === d.timelockPolicy.toLowerCase()) {
    return { address, kind: 'policy-timelock', label: 'Policy timelock (6h)' }
  }
  const code = await client(chainId).getCode({ address })
  const hasCode = Boolean(code && code !== '0x')
  return hasCode
    ? { address, kind: 'contract', label: `Unrecognized contract (${shortAddr(address)})` }
    : { address, kind: 'eoa', label: `EOA (${shortAddr(address)})` }
}

export interface OwnershipRow {
  contractName: string
  contractAddress: Address
  /** False when `owner()` reverted — the contract is not Ownable (e.g.
   *  LatchRegistry, which is AccessControl-governed instead). */
  ownable: boolean
  /** Every owner() hop actually read, ending at the ultimate answer — e.g.
   *  CLPoolManager -> CLPoolManagerOwner -> Safe. Nothing here is inferred;
   *  each entry came from a real `owner()` call. */
  chain: ResolvedOwner[]
  pendingOwner: Address | null
  isEOAOwned: boolean
}

const MAX_OWNER_HOPS = 4

async function followOwnerChain(
  chainId: DeployedChainId,
  start: Address,
): Promise<{ ownable: boolean; chain: ResolvedOwner[] }> {
  const c = client(chainId)
  const chain: ResolvedOwner[] = []
  let current = start
  let ownableAtAll = false

  for (let hop = 0; hop < MAX_OWNER_HOPS; hop++) {
    let owner: Address
    try {
      owner = (await c.readContract({ address: current, abi: OWNABLE_ABI, functionName: 'owner' })) as Address
    } catch {
      break
    }
    ownableAtAll = true
    const resolved = await resolveOwnerName(chainId, owner)
    chain.push(resolved)
    // Safe, a known timelock, or an EOA all terminate the chain cleanly. Only
    // an unrecognized CONTRACT is worth another hop — that is exactly the
    // *PoolManagerOwner wrapper case, discovered from chain rather than
    // hardcoded.
    if (resolved.kind !== 'contract') break
    current = owner
  }

  return { ownable: ownableAtAll, chain }
}

/** Every Ownable contract this deployment carries, plus LatchRegistry — which
 *  is included specifically to show it is NOT Ownable (it is AccessControl,
 *  governed by DEFAULT_ADMIN_ROLE instead), so its absence from `owner()`
 *  reads as a checked fact rather than an omission. */
function ownableTargets(chainId: DeployedChainId): { name: string; address: Address }[] {
  const d = DEPLOYMENTS[chainId]
  return [
    { name: 'Vault', address: d.vault },
    { name: 'CLPoolManager', address: d.clPoolManager },
    { name: 'BinPoolManager', address: d.binPoolManager },
    { name: 'LatchProtocolFeeController', address: d.feeController },
    { name: 'LatchRegistry', address: d.registry },
    { name: 'CLPositionDescriptor', address: d.clPositionDescriptor },
    { name: 'UniversalRouter', address: d.universalRouter },
    { name: 'Create3Factory', address: d.create3Factory },
    { name: 'CLPositionManager', address: d.clPositionManager },
    { name: 'BinPositionManager', address: d.binPositionManager },
    { name: 'CLQuoter', address: d.clQuoter },
    { name: 'BinQuoter', address: d.binQuoter },
  ]
}

export async function readOwnershipTable(chainId: DeployedChainId): Promise<OwnershipRow[]> {
  const c = client(chainId)

  return Promise.all(
    ownableTargets(chainId).map(async ({ name, address }) => {
      const { ownable, chain } = await followOwnerChain(chainId, address)

      let pendingOwner: Address | null = null
      if (ownable) {
        try {
          const p = (await c.readContract({
            address,
            abi: OWNABLE_ABI,
            functionName: 'pendingOwner',
          })) as Address
          pendingOwner = p === zeroAddress ? null : p
        } catch {
          // Plain Ownable (no two-step transfer), or the call reverted for
          // some other reason — either way there is no pending transfer to
          // show, which is the honest default.
          pendingOwner = null
        }
      }

      const final = chain[chain.length - 1]
      return {
        contractName: name,
        contractAddress: address,
        ownable,
        chain,
        pendingOwner,
        isEOAOwned: final?.kind === 'eoa',
      }
    }),
  )
}

/* --------------------------------------------------------------------------
   Queued timelock operations
   -------------------------------------------------------------------------- */

export type OperationStatus = 'pending' | 'ready' | 'done' | 'unknown'

export interface QueuedOperation {
  chainId: DeployedChainId
  timelockAddress: Address
  tier: TimelockTier
  id: Hex
  index: bigint
  target: Address
  value: bigint
  data: Hex
  predecessor: Hex
  delaySec: bigint
  scheduledAtBlock: bigint
  scheduledTxHash: Hex
  /** Raw `getTimestamp(id)`. `0` = never scheduled, `1` = done (OZ's
   *  `_DONE_TIMESTAMP` sentinel — NOT a real date), otherwise the unix second
   *  the operation becomes executable. Only meaningful as a date when
   *  `status` is `pending` or `ready`. */
  readyAtSec: bigint
  status: OperationStatus
  /** `0x79ba5097` decoded as `acceptOwnership()` per CLAUDE.md. Any other
   *  selector is shown as its raw hex rather than guessed. `null` for a plain
   *  value transfer with no calldata. */
  decodedCall: string | null
}

/** Ownable2Step's `acceptOwnership()` selector — the only call this screen
 *  decodes by name. Everything else renders as its raw selector. */
const ACCEPT_OWNERSHIP_SELECTOR = '0x79ba5097'

function decodeCall(data: Hex): string | null {
  if (data === '0x') return null
  const selector = data.slice(0, 10)
  return selector === ACCEPT_OWNERSHIP_SELECTOR ? 'acceptOwnership()' : selector
}

/** One `CallScheduled` log, before its live status has been read back. */
interface ScheduledSeed {
  timelockAddress: Address
  tier: TimelockTier
  id: Hex
  index: bigint
  target: Address
  value: bigint
  data: Hex
  predecessor: Hex
  delaySec: bigint
  scheduledAtBlock: bigint
  scheduledTxHash: Hex
}

/**
 * Queued operations across SEVERAL timelocks, sharing one windowed scan.
 *
 * WINDOWED. This used to be one `getLogs` per timelock over
 * `deployedAtBlock -> 'latest'`, which the Robinhood endpoints refuse
 * (`block range too large`) — so the Governance screen's operations panel never
 * left its loading state. Both timelocks now go through `scanWindowsMulti`,
 * which slices the range AND keeps the two queries inside one concurrency
 * budget instead of putting six requests in flight against an endpoint sized
 * for three.
 *
 * Exhaustive rather than "latest N": a queued operation this scan misses is one
 * the screen would not warn about, and an unnoticed `updateDelay(0)` sitting in
 * the queue is precisely the hazard the panel exists for.
 */
async function readQueuedOperationsAcross(
  chainId: DeployedChainId,
  timelocks: readonly { address: Address; tier: TimelockTier }[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<QueuedOperation[]> {
  const c = client(chainId)

  /* Mapped to `ScheduledSeed` inside each callback, where viem still knows the
     event's ABI — passing the query out through a widened type is what would
     make `l.args` untyped and `l.blockNumber` nullable. */
  const seeds = await scanWindowsMulti<ScheduledSeed>(
    fromBlock,
    toBlock,
    timelocks.map(
      ({ address, tier }) =>
        async (from: bigint, to: bigint) =>
          (
            await c.getLogs({
              address,
              event: CALL_SCHEDULED_EVENT[0],
              fromBlock: from,
              toBlock: to,
            })
          ).map(
            (l): ScheduledSeed => ({
              timelockAddress: address,
              tier,
              id: l.args.id as Hex,
              index: l.args.index as bigint,
              target: l.args.target as Address,
              value: l.args.value as bigint,
              data: l.args.data as Hex,
              predecessor: l.args.predecessor as Hex,
              delaySec: l.args.delay as bigint,
              scheduledAtBlock: l.blockNumber,
              scheduledTxHash: l.transactionHash,
            }),
          ),
    ),
    'queued timelock operations (CallScheduled)',
  )

  const ops = await Promise.all(
    seeds.map(async (s) => {
      const [pending, ready, done, timestamp] = await Promise.all([
        c.readContract({ address: s.timelockAddress, abi: TIMELOCK_ABI, functionName: 'isOperationPending', args: [s.id] }),
        c.readContract({ address: s.timelockAddress, abi: TIMELOCK_ABI, functionName: 'isOperationReady', args: [s.id] }),
        c.readContract({ address: s.timelockAddress, abi: TIMELOCK_ABI, functionName: 'isOperationDone', args: [s.id] }),
        c.readContract({ address: s.timelockAddress, abi: TIMELOCK_ABI, functionName: 'getTimestamp', args: [s.id] }),
      ])
      const status: OperationStatus = done ? 'done' : ready ? 'ready' : pending ? 'pending' : 'unknown'

      const op: QueuedOperation = {
        chainId,
        timelockAddress: s.timelockAddress,
        tier: s.tier,
        id: s.id,
        index: s.index,
        target: s.target,
        value: s.value,
        data: s.data,
        predecessor: s.predecessor,
        delaySec: s.delaySec,
        scheduledAtBlock: s.scheduledAtBlock,
        scheduledTxHash: s.scheduledTxHash,
        readyAtSec: timestamp,
        status,
        decodedCall: decodeCall(s.data),
      }
      return op
    }),
  )

  return ops.sort((a, b) => Number(b.scheduledAtBlock - a.scheduledAtBlock))
}

/** One timelock's queued operations. `toBlock` defaults to the current head. */
export async function readQueuedOperations(
  chainId: DeployedChainId,
  timelockAddress: Address,
  tier: TimelockTier,
  fromBlock: bigint,
  toBlock?: bigint,
): Promise<QueuedOperation[]> {
  const head = toBlock ?? (await client(chainId).getBlockNumber())
  return readQueuedOperationsAcross(chainId, [{ address: timelockAddress, tier }], fromBlock, head)
}

/* --------------------------------------------------------------------------
   One fetch for the whole screen
   -------------------------------------------------------------------------- */

export interface GovernanceData {
  chainId: DeployedChainId
  safe: SafeStatus
  timelocks: readonly [TimelockStatus, TimelockStatus]
  ownership: OwnershipRow[]
  operations: QueuedOperation[]
  latestBlock: bigint
}

/** A name for any address this screen already knows, for labelling an
 *  operation's target — falls back to `null` (render the raw address) rather
 *  than guessing. */
export function nameForAddress(chainId: DeployedChainId, address: Address): string | null {
  const d = DEPLOYMENTS[chainId]
  const lower = address.toLowerCase()
  if (lower === SAFE_ADDRESS.toLowerCase()) return 'Safe'
  if (lower === d.timelockCustody.toLowerCase()) return 'Custody timelock'
  if (lower === d.timelockPolicy.toLowerCase()) return 'Policy timelock'
  for (const { name, address: a } of ownableTargets(chainId)) {
    if (a.toLowerCase() === lower) return name
  }
  return null
}

export async function readGovernanceData(chainId: DeployedChainId): Promise<GovernanceData> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  /* The head is read FIRST and then handed to the scan, so both timelocks are
     scanned over exactly the same range and one shared window walk can serve
     them. Two independent scans would also double the requests in flight
     against an endpoint that rate-limits by request count. */
  const latestBlock = await c.getBlockNumber()

  const [safe, custody, policy, ownership, operations] = await Promise.all([
    readSafeStatus(chainId),
    readTimelockStatus(chainId, d.timelockCustody, 'Custody'),
    readTimelockStatus(chainId, d.timelockPolicy, 'Policy'),
    readOwnershipTable(chainId),
    readQueuedOperationsAcross(
      chainId,
      [
        { address: d.timelockCustody, tier: 'Custody' },
        { address: d.timelockPolicy, tier: 'Policy' },
      ],
      d.deployedAtBlock,
      latestBlock,
    ),
  ])

  return {
    chainId,
    safe,
    timelocks: [custody, policy],
    ownership,
    operations,
    latestBlock,
  }
}

/* --------------------------------------------------------------------------
   Formatting — small and local so this module has no dependency on
   `lib/revshare.ts`, which carries the same helpers for a different screen.
   -------------------------------------------------------------------------- */

export function shortAddr(value: string, lead = 6, tail = 4): string {
  return value.length > lead + tail + 2 ? `${value.slice(0, lead)}…${value.slice(-tail)}` : value
}

export function fmtHours(seconds: bigint): string {
  const n = Number(seconds)
  if (n % 3600 === 0) return `${n / 3600}h`
  return `${(n / 3600).toFixed(2)}h`
}

/** A unix-seconds timestamp as UTC. Callers must not pass OZ's `1` sentinel
 *  (`_DONE_TIMESTAMP`) — that is not a date, it means "already executed". */
export function fmtWhen(seconds: bigint): string {
  return `${new Date(Number(seconds) * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`
}

/** Seconds remaining until `readyAtSec`, against wall-clock `nowSec`. Negative
 *  once the window has opened but before the screen's next chain read notices. */
export function secondsRemaining(readyAtSec: bigint, nowSec: number): number {
  return Number(readyAtSec) - nowSec
}

export function fmtCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'ready now'
  const d = Math.floor(totalSeconds / 86400)
  const h = Math.floor((totalSeconds % 86400) / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
