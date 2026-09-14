// FIXTURES FOR UI TESTING ONLY. Shapes mirror apps/api/src/admin/service.ts.
//
// Where a value is a recorded fact it cites its source (CLAUDE.md "VERIFIED LIVE
// STATE", "The canceller", apps/api/README.md live run, the SDK address book).
// Values marked LAYOUT are placeholders that exist only to exercise a table
// row; they are not chain reads and must never be copied into product code.

const SAFE = '0x715a6176946adbd22c1b2021d321fb3767ca3432'
const CUSTODY = '0x3ae354e2cdfb9cb855aba41c825f6ee53f28e119'
const POLICY = '0x1da3ad33ab8151af9ee91b90fa23ffddff9c0c3a'
const ZERO = '0x0000000000000000000000000000000000000000'
const CANCELLER = '0xe65f304e40b61d7417154cb3e725c0ee16701142'
const OPS = '0x304b0cc019cdba6c7c767d86a2a34e69fdb3c9a9'
const VAULT = '0x78e8359c6d34df797b8a793de8c7c6bffa97fb6c'
const CLPMO = '0x5d7111d6c624e9a08ae63d342e4bae5878989a67'
const BINPMO = '0x98920e33313257ffd942f94379a7ced216462665'
const CLPM = '0xf4a28fa4cfecaef349a7d52fa1eb4df56eb22f66'
const BINPM = '0x1bb57b3a59b69f128700ff59cc6ee22835ae6979'
const FEE = '0x9c2c09efbdb1726d3563b3f92f9912c9134f54ab'
const REGISTRY = '0xb2c8bb7473a09b0906f192d69e30d7362fa988cc'
const LTT1 = '0x2a21c0826848f2d597b7c87a4b931de1407958a6'
const LTT2 = '0xa29927045bdffd61b8f539d491085f1b6f7a8be4'
const DEMO_POOL = '0xcb1fbdafcaa52a0cc8f5ece1752737c2a5eec2b7242953270c15bdd9818a50e8'
const RETIRED_HOOK = '0x23ce34e8199927dd270dddd8579c947542bde446'
const now = new Date().toISOString()
const READY_AT = '2026-09-14T18:40:43.000Z' // CLAUDE.md: executable from unix 1789411243
const SCHEDULED_TS = '2026-09-12T18:40:43.000Z'

// CLAUDE.md "VERIFIED LIVE STATE": the three queued acceptOwnership() operations.
const OPS_QUEUED = [
  ['vault', VAULT, '0xb04e05ca3f8018246e91f8c15d2d3e4f2108afb9b44b3961e90573f026d5f33d', '0xe17bfec589d6a2594c2d59f7a1455e637425f2d5a4cbbcdf9062e39fad16e555'],
  ['clPoolManagerOwner', CLPMO, '0xab9c8f8e5fc6f02fafbc903847adccebca65b5811f5489993d9c0033721ebf00', '0xb0ecc7113374d7c91a718f0d7a67a59bbf2efaaaf0f6c3a209b541cb4e3de097'],
  ['binPoolManagerOwner', BINPMO, '0x700f7b00af4f2d2109587a37f6dc3b12477e074385fa1e23a72f482ea1be4f6e', '0x4787d44da9b61fa3107ab9bd0ef45f807be8debdaa46b66a2ae96ceb458a62c1'],
]
const operations = OPS_QUEUED.map(([, target, id, salt]) => ({
  chainId: 4663,
  timelock: CUSTODY,
  tier: 'custody',
  operationId: id,
  status: 'PENDING',
  scheduledAt: { blockNumber: '61325176', blockTimestamp: SCHEDULED_TS, txHash: '0x' + 'ab'.repeat(32) },
  delaySeconds: '172800',
  readyAt: READY_AT,
  executedAt: null,
  cancelledAt: null,
  salt,
  predecessor: '0x' + '0'.repeat(64),
  calls: [{ index: 0, target, value: '0', data: '0x79ba5097', selector: '0x79ba5097', functionSignature: 'function acceptOwnership()', decoded: { functionName: 'acceptOwnership', signature: 'acceptOwnership()', args: [] }, roleName: null, hazard: null, hazardNote: null }],
  hazards: [],
}))

const handoverAlert = (key, target, opId) => ({
  id: `own:4663:${key}:custody-handover-unaccepted`,
  severity: 'HIGH',
  category: 'governance',
  chainId: 4663,
  title: `${key}: custody handover proposed, not yet accepted`,
  detail: `owner() is the Safe (0x715a…3432); pendingOwner() is the 48 h custody timelock. Until the timelock accepts, ${key === 'vault' ? 'registerApp (irreversible, permanent fund access)' : 'pause and fee authority over every pool'} needs only 2-of-3 Safe signatures with no public delay. Operation ${opId} is queued; executable by anyone from ${READY_AT}.`,
  subject: target,
  provenance: 'ownership_snapshots @ block 62509876 (fixture); operation from timelock_events',
  action: { label: 'See the queued operation', page: 'governance' },
})

const alerts = [
  { id: 'ops:4663:canceller', severity: 'CRITICAL', category: 'safety', chainId: 4663, title: 'canceller balance below its critical threshold', detail: "1183834050000 wei affords 0 action(s) at 78334000 wei/gas (critical below 19583500000000 wei). The canceller's only power is refusal, and it cannot refuse without gas. Fund it.", subject: CANCELLER, provenance: 'ops_balances (fixture; balance and gas price from CLAUDE.md "The canceller", re-read 2026-09-13)', action: { label: 'Safety', page: 'safety' } },
  ...OPS_QUEUED.map(([k, t, id]) => handoverAlert(k, t, id)),
  { id: 'role:4663:timelockPolicy:canceller', severity: 'LOW', category: 'governance', chainId: 4663, title: 'timelockPolicy: hasRole:CANCELLER_ROLE is not as the Ownership table says', detail: 'The canceller does not hold CANCELLER_ROLE on the policy timelock. CLAUDE.md: low impact while that timelock holds only the cosmetic descriptor; move the descriptor to the Safe or grant the role.', subject: POLICY, provenance: 'ownership_snapshots (fixture; CLAUDE.md VERIFIED LIVE STATE)', action: null },
  { id: 'own:4663:clPositionDescriptor:mismatch', severity: 'LOW', category: 'governance', chainId: 4663, title: 'clPositionDescriptor owner differs from the Ownership table', detail: 'Expected Safe (0x715a…3432), owner() is 0x1da3…0c3a, nothing pending. Cosmetic: the descriptor only sets a metadata URI.', subject: '0x0af03bee134ce66ee12425ee05a50f32c72644eb', provenance: 'ownership_snapshots (fixture; CLAUDE.md VERIFIED LIVE STATE)', action: null },
  { id: 'moderation:pending', severity: 'INFO', category: 'moderation', chainId: null, title: '1 listing submission(s) awaiting review', detail: 'Submitted through POST /v1/listings. Nothing is public until approved.', subject: null, provenance: 'listing_submissions', action: { label: 'Moderation', page: 'moderation' } },
]
const counts = { CRITICAL: 1, HIGH: 3, MEDIUM: 0, LOW: 2, INFO: 1 }

const cell = (observed, expected, tier) => ({ observed, expected, expectedTier: tier, matches: observed === expected, readError: null, readAtBlock: '62509876', readAt: now })

export const fixtures = {
  session: {
    address: '0x1bfb63db0ca9a647d9538715ce9ae36e16f4ea73',
    roles: ['admin', 'curator'],
    grants: [
      { role: 'admin', reason: 'Safe owner', source: `getOwners() on the governance Safe ${SAFE} (chain 4663)` },
      { role: 'curator', reason: 'Registry curator', source: `hasRole(CURATOR_ROLE) on LatchRegistry ${REGISTRY} (chain 4663)` },
    ],
    chainId: 4663,
    csrfToken: 'fixture-csrf',
  },
  get: {
    overview: {
      chainId: 4663,
      generatedAt: now,
      // apps/api/README.md live run: indexed to 62,509,876; 100-block confirmation lag.
      indexer: { indexed: true, lastIndexedBlock: '62509876', lastIndexedBlockTimestamp: now, headBlock: '62509976', headObservedAt: now, lagBlocks: '100', contractBlockNumber: '25972228', contractClockReadAt: now },
      alerts: { counts, top: alerts },
      revenue: {
        provenance: 'revenue_ledger, logs from block 60111836 to 62509876',
        received: [],
        // README live run: protocol fee 0 on LTT1/LTT2.
        uncollectedAccrued: [
          { poolManager: CLPM, token: LTT1, symbol: 'LTT1', raw: '0', units: '0', readAtBlock: '62509876', readAt: now },
          { poolManager: CLPM, token: LTT2, symbol: 'LTT2', raw: '0', units: '0', readAtBlock: '62509876', readAt: now },
        ],
        notDeployed: [
          { source: 'LP_LOCKER_PROTOCOL_CLAIM', label: 'LP locker: protocol share', note: 'Not deployed on this chain and not in the SDK address book, so there is nothing to index. Not zero: unmeasured.' },
          { source: 'LP_LOCKER_INTEGRATOR_CLAIM', label: 'LP locker: integrator share', note: 'Not deployed on this chain and not in the SDK address book. Not zero: unmeasured.' },
          { source: 'KIT_LAUNCH_FEE', label: 'Kit launch fees', note: 'The deployed LaunchpadKit charges no launch fee; v2 (createLaunch fee) is not deployed. Not zero: unmeasured.' },
        ],
      },
      moderation: { PENDING: 1 },
      apiKeys: { byStatus: { ACTIVE: 1 }, requestsThisMonth: '0', period: now.slice(0, 7) },
    },
    alerts: { chainId: 4663, generatedAt: now, counts, alerts },
    revenue: {
      chainId: 4663,
      filters: { token: null, source: null, window: 'all', usd: false },
      provenance: { source: 'revenue_ledger (range-replaced with the logs it came from)', fromBlock: '60111836', toBlock: '62509876', toBlockTimestamp: now, note: 'Token units with symbols. Flows carry USD only if the ledger row was priced by an oracle when written (none are today); USD on accrued balances is the current feed value of a current balance.' },
      totalsBySource: [
        { source: 'PROTOCOL_FEE_COLLECTED', label: 'Protocol fees collected via collect()', status: 'indexed', contract: 'LatchProtocolFeeControllerV2', note: '', byToken: [] },
        { source: 'PROTOCOL_FEE_SWEPT', label: 'Fee-controller sweeps to treasury', status: 'indexed', contract: 'LatchProtocolFeeControllerV2', note: '', byToken: [] },
        { source: 'REVSHARE_PROTOCOL_CLAIM', label: 'RevShare roster payouts to the protocol', status: 'indexed', contract: "RevShareHook (Latch's own deployments)", note: '', byToken: [] },
        { source: 'LP_LOCKER_PROTOCOL_CLAIM', label: 'LP locker: protocol share', status: 'not-deployed', contract: 'LatchLPLocker', note: 'Not deployed on this chain and not in the SDK address book. Not zero: unmeasured.', byToken: null },
        { source: 'LP_LOCKER_INTEGRATOR_CLAIM', label: 'LP locker: integrator share', status: 'not-deployed', contract: 'LatchLPLocker', note: 'Not deployed on this chain and not in the SDK address book. Not zero: unmeasured.', byToken: null },
        { source: 'KIT_LAUNCH_FEE', label: 'Kit launch fees', status: 'not-deployed', contract: 'LaunchpadKit v2', note: 'The deployed LaunchpadKit charges no launch fee; v2 is not deployed. Not zero: unmeasured.', byToken: null },
      ],
      protocolFees: {
        charged: { definition: 'Swap-log protocol-fee slice: amountIn x protocolFee / 1e6 per swap.', byToken: [{ token: LTT1, symbol: 'LTT1', swaps: 1, raw: '0', units: '0' }, { token: LTT2, symbol: 'LTT2', swaps: 1, raw: '0', units: '0' }] },
        collected: { definition: 'ProtocolFeesCollected on the V2 controller, split by how it was called.', byTokenAndMethod: [] },
        accruedUncollected: { definition: 'protocolFeesAccrued(currency) on each pool manager, latest snapshot. Not windowed.', items: [{ poolManager: CLPM, token: LTT1, symbol: 'LTT1', raw: '0', units: '0', readAtBlock: '62509876', usd: null }] },
      },
      ledger: { total: 0, limit: 50, offset: 0, items: [] },
    },
    protocol: {
      chainId: 4663,
      provenance: { toBlock: '62509876', toBlockTimestamp: now, fromBlock: '60111836', note: 'Summed from logs; no cumulative counter is implied.' },
      pools: [
        {
          poolId: DEMO_POOL,
          poolType: 'CL',
          token0: { address: LTT1, symbol: 'LTT1' },
          token1: { address: LTT2, symbol: 'LTT2' },
          hooks: RETIRED_HOOK,
          feeRaw: 3000,
          swaps: 2,
          lastSwapAt: now,
          byInputToken: [
            // README: tx 0x68286e9b… paid in exactly 1e18 LTT1; fee 0.30%, protocol fee 0.
            { token: LTT1, symbol: 'LTT1', swaps: 1, volumeIn: '1', feesTotal: '0.003', feesLp: '0.003', feesProtocol: '0', volumeInRaw: '1000000000000000000' },
            // LAYOUT: the second swap's amount is not recorded in the repo.
            { token: LTT2, symbol: 'LTT2', swaps: 1, volumeIn: null, feesTotal: null, feesLp: null, feesProtocol: '0', volumeInRaw: '0' },
          ],
          state: { readAtBlock: '62509876', lpFeePips: 3000, protocolFeePacked: 0, readError: null },
          createdAt: { blockNumber: '60244000', txHash: '0x' + 'cd'.repeat(32) },
        },
      ],
      volumeAllTime: [{ token: LTT1, symbol: 'LTT1', swapsIn: 1, volumeIn: '1', volumeInRaw: '1000000000000000000', fees: { total: '0.003', lp: '0.003', protocol: '0' } }],
      launches: { total: 0, items: [] },
      registry: { note: 'Risk class is the one LatchRegistered recorded at registration. A listing is not an audit.', listings: [] },
      appRegistrations: [
        { app: CLPM, blockNumber: '60112000', txHash: '0x' + 'ef'.repeat(32), note: 'Vault.registerApp is irreversible.' },
        { app: BINPM, blockNumber: '60112010', txHash: '0x' + 'fe'.repeat(32), note: 'Vault.registerApp is irreversible.' },
      ],
    },
    'governance/ownership': {
      chainId: 4663,
      source: 'ownership_snapshots',
      addresses: { safe: SAFE, timelockCustody: CUSTODY, timelockPolicy: POLICY },
      contracts: [
        { contractKey: 'vault', address: VAULT, expectedTier: 'Custody (48h timelock)', expectedAddress: CUSTODY, owner: cell(SAFE, CUSTODY, 'Custody (48h timelock)'), pendingOwner: cell(CUSTODY, ZERO, 'none pending'), alert: alerts[1] },
        { contractKey: 'clPoolManagerOwner', address: CLPMO, expectedTier: 'Custody (48h timelock)', expectedAddress: CUSTODY, owner: cell(SAFE, CUSTODY, 'Custody (48h timelock)'), pendingOwner: cell(CUSTODY, ZERO, 'none pending'), alert: alerts[2] },
        { contractKey: 'binPoolManagerOwner', address: BINPMO, expectedTier: 'Custody (48h timelock)', expectedAddress: CUSTODY, owner: cell(SAFE, CUSTODY, 'Custody (48h timelock)'), pendingOwner: cell(CUSTODY, ZERO, 'none pending'), alert: alerts[3] },
        { contractKey: 'clPoolManager', address: CLPM, expectedTier: 'CLPoolManagerOwner wrapper', expectedAddress: CLPMO, owner: cell(CLPMO, CLPMO, 'CLPoolManagerOwner wrapper'), pendingOwner: null, alert: null },
        { contractKey: 'binPoolManager', address: BINPM, expectedTier: 'BinPoolManagerOwner wrapper', expectedAddress: BINPMO, owner: cell(BINPMO, BINPMO, 'BinPoolManagerOwner wrapper'), pendingOwner: null, alert: null },
        { contractKey: 'feeController', address: FEE, expectedTier: 'Safe', expectedAddress: SAFE, owner: cell(SAFE, SAFE, 'Safe'), pendingOwner: cell(ZERO, ZERO, 'none pending'), alert: null },
        { contractKey: 'clPositionDescriptor', address: '0x0af03bee134ce66ee12425ee05a50f32c72644eb', expectedTier: 'Safe', expectedAddress: SAFE, owner: cell(POLICY, SAFE, 'Safe'), pendingOwner: cell(ZERO, ZERO, 'none pending'), alert: alerts[5] },
      ],
      otherChecks: [
        { contractKey: 'timelockCustody', address: CUSTODY, check: `hasRole:PROPOSER_ROLE:${SAFE}`, observed: 'true', expectedTier: 'Safe is proposer', expected: 'true', matches: true, readError: null, readAtBlock: '62509876' },
        { contractKey: 'timelockCustody', address: CUSTODY, check: `hasRole:EXECUTOR_ROLE:${ZERO}`, observed: 'true', expectedTier: 'address(0) is executor (permissionless execution)', expected: 'true', matches: true, readError: null, readAtBlock: '62509876' },
        { contractKey: 'timelockCustody', address: CUSTODY, check: `hasRole:CANCELLER_ROLE:${CANCELLER}`, observed: 'true', expectedTier: 'dedicated canceller holds CANCELLER_ROLE', expected: 'true', matches: true, readError: null, readAtBlock: '62509876' },
        { contractKey: 'timelockPolicy', address: POLICY, check: `hasRole:CANCELLER_ROLE:${CANCELLER}`, observed: 'false', expectedTier: 'dedicated canceller holds CANCELLER_ROLE', expected: 'true', matches: false, readError: null, readAtBlock: '62509876' },
        { contractKey: 'feeController', address: FEE, check: 'treasury', observed: SAFE, expectedTier: 'Safe (protocol fees go to the Safe)', expected: SAFE, matches: true, readError: null, readAtBlock: '62509876' },
      ],
      alerts: alerts.filter((a) => a.category === 'governance'),
    },
    'governance/timelock': {
      chainId: 4663,
      now,
      source: 'timelock_events',
      timelocks: [{ tier: 'custody', address: CUSTODY }, { tier: 'policy', address: POLICY }],
      doNotQueue: ['renounceOwnership()', 'updateDelay(uint256)'],
      custodyHandover: { note: 'acceptOwnership() operations on the custody timelock, one per contract. The owner() read on the Ownership check is the proof, not these operations.', items: OPS_QUEUED.map(([k, t, id]) => ({ contractKey: k, target: t, operationId: id, status: 'PENDING', readyAt: READY_AT, saltIndexed: true })) },
      operations,
      delayChanges: [],
    },
    'governance/roles': {
      source: 'RoleGranted/RoleRevoked replayed from logs',
      holders: [
        { contractKey: 'timelockCustody', contract: CUSTODY, role: 'PROPOSER_ROLE', account: SAFE, accountLabel: 'Governance Safe', lastChange: { event: 'RoleGranted', blockNumber: '60111836', txHash: '0x' + '11'.repeat(32) } },
        { contractKey: 'timelockCustody', contract: CUSTODY, role: 'EXECUTOR_ROLE', account: ZERO, accountLabel: 'address(0): anyone', lastChange: { event: 'RoleGranted', blockNumber: '60111836', txHash: '0x' + '11'.repeat(32) } },
        { contractKey: 'timelockCustody', contract: CUSTODY, role: 'CANCELLER_ROLE', account: CANCELLER, accountLabel: 'canceller', lastChange: { event: 'RoleGranted', blockNumber: '60111836', txHash: '0x' + '11'.repeat(32) } },
        { contractKey: 'timelockPolicy', contract: POLICY, role: 'PROPOSER_ROLE', account: SAFE, accountLabel: 'Governance Safe', lastChange: { event: 'RoleGranted', blockNumber: '60111836', txHash: '0x' + '12'.repeat(32) } },
        { contractKey: 'registry', contract: REGISTRY, role: 'DEFAULT_ADMIN_ROLE', account: SAFE, accountLabel: 'Governance Safe', lastChange: { event: 'RoleGranted', blockNumber: '60112500', txHash: '0x' + '13'.repeat(32) } },
      ],
      revoked: [],
      currentReads: [],
    },
    safety: {
      chainId: 4663,
      contractClock: { contractBlockNumber: '25972228', method: 'eth_call NUMBER probe', readAt: now },
      pendingConfigs: { note: 'Judged on the CONTRACT clock. legacy = 0x23CE shape, no expiry; current = 0xfC00 shape with expiryBlock.', items: [{ hook: RETIRED_HOOK, poolId: DEMO_POOL, shape: 'legacy', status: 'NONE', effectiveContractBlock: '0', expiryContractBlock: null, params: {}, contractBlockNumber: '25972228', readAtBlock: '62509876', readAt: now, readError: null }] },
      opsBalances: {
        gasReference: { referenceGasPriceWei: '78334000', referenceSource: 'CLAUDE.md' },
        items: [
          { label: 'canceller', address: CANCELLER, purpose: 'Sole CANCELLER_ROLE on the custody timelock.', balanceWei: '1183834050000', balance: '0.00000118383405', nativeSymbol: 'ETH', criticalWei: '19583500000000', warnWei: '195835000000000', gasPriceWei: '78334000', gasPriceSource: 'config reference price', actionsAffordable: '0', severity: 'CRITICAL', rationale: 'TimelockController.cancel(bytes32) on the custody timelock: 250000 gas each; CRITICAL below 1, WARN below 10. See config/chains/4663.json.', readAtBlock: '62509876', readAt: now },
          // LAYOUT: the ops wallet's balance is not recorded in the repo.
          { label: 'ops-wallet', address: OPS, purpose: 'Deployer, keeper, guardian, oracle publisher.', balanceWei: '2500000000000000', balance: '0.0025', nativeSymbol: 'ETH', criticalWei: '235002000000000', warnWei: '1410012000000000', gasPriceWei: '78334000', gasPriceSource: 'config reference price', actionsAffordable: '106', severity: 'OK', rationale: 'one keeper or guardian transaction: 300000 gas each; CRITICAL below 10, WARN below 60.', readAtBlock: '62509876', readAt: now },
        ],
      },
      // LAYOUT: freshness values are placeholders.
      feeds: [
        { label: 'NVDA/USD', proxy: '0x379ec4f7c378f34a1b47e4f3cbebcbac3e8e9f15', description: 'RHNVDA / USD', answer: null, decimals: 8, feedUpdatedAt: now, stalenessSeconds: 3600, heartbeatSeconds: 86400, heartbeatViolation: false, error: null, readAtBlock: '62509876', readAt: now },
        { label: 'SPY/USD', proxy: '0x319724394d3a0e3669269846abe664cd621f9f6a', description: 'RHSPY / USD', answer: null, decimals: 8, feedUpdatedAt: now, stalenessSeconds: 90000, heartbeatSeconds: 86400, heartbeatViolation: true, error: null, readAtBlock: '62509876', readAt: now },
      ],
      stockTokens: { note: 'Every token in an indexed pool that answers tokenPaused() or uiMultiplier().', current: [], changes: [] },
    },
    'safe/context': {
      chainId: 4663,
      chainName: 'Robinhood Chain',
      safe: '0x715a6176946aDbD22c1B2021d321Fb3767ca3432',
      safeAppUrl: 'https://app.safe.global/home?safe=robinhood:0x715a6176946aDbD22c1B2021d321Fb3767ca3432',
      safeAppSource: 'ops/safe/README.md',
      contracts: { vault: VAULT, clPoolManager: CLPM, binPoolManager: BINPM, clPoolManagerOwner: CLPMO, binPoolManagerOwner: BINPMO, feeController: FEE, registry: REGISTRY, timelockCustody: CUSTODY, timelockPolicy: POLICY },
      note: 'The panel prepares payloads and simulates them with eth_call. It never signs, never proposes to the Safe Transaction Service, and never sends.',
    },
    'moderation/listings': {
      total: 1,
      counts: { PENDING: 1 },
      // LAYOUT: an example submission, not a real project.
      items: [{ id: 'cfixturelisting000000001', kind: 'PROJECT', status: 'PENDING', name: 'Fixture Project', description: 'A test-fixture submission used to render the moderation queue.', websiteUrl: 'https://example.org', sourceUrl: null, category: 'DEX', categoryOther: null, uses: ['rev-share'], ownLatch: null, chains: [4663], iconSourceUrl: null, hasIcon: false, turnstileVerified: false, reviewer: null, reviewNotes: null, reviewedAt: null, createdAt: now }],
    },
    'keys/accounts': { items: [{ id: 'cfixtureaccount000000001', name: 'Fixture account', plan: 'free', keys: 1, billingProvider: null, createdAt: now }] },
    keys: { period: now.slice(0, 7), usageSource: 'api_usage_monthly (fixture)', items: [{ id: 'cfixturekey0000000000001', account: { id: 'cfixtureaccount000000001', name: 'Fixture account' }, name: 'fixture', prefix: 'latchk_fixturefixtu_…', scopes: ['public:read', 'dexscreener:read'], status: 'ACTIVE', rateLimitPerMinute: 600, monthlyQuota: 1000000, createdAt: now, expiresAt: null, revokedAt: null, revokedReason: null, lastUsedAt: null, usage: [] }] },
    audit: {
      total: 2,
      limit: 50,
      offset: 0,
      items: [
        { id: 'a2', actor: '0x1bfb63db0ca9a647d9538715ce9ae36e16f4ea73', actorRoles: ['admin', 'curator'], action: 'apikey.mint', targetType: 'api_key', targetId: 'cfixturekey0000000000001', before: null, after: { prefix: 'fixturefixtu', scopes: ['public:read', 'dexscreener:read'] }, requestId: 'req-fixture-2', ip: '127.0.0.1', createdAt: now },
        { id: 'a1', actor: '0x1bfb63db0ca9a647d9538715ce9ae36e16f4ea73', actorRoles: ['admin', 'curator'], action: 'auth.signin', targetType: 'session', targetId: 'abcdef012345', before: null, after: null, requestId: 'req-fixture-1', ip: '127.0.0.1', createdAt: now },
      ],
    },
  },
  listingDetail: { id: 'cfixturelisting000000001', kind: 'PROJECT', status: 'PENDING', name: 'Fixture Project', description: 'A test-fixture submission used to render the moderation queue.', websiteUrl: 'https://example.org', sourceUrl: null, category: 'DEX', categoryOther: null, uses: ['rev-share'], ownLatch: null, chains: [4663], iconSourceUrl: null, hasIcon: false, turnstileVerified: false, reviewer: null, reviewNotes: null, reviewedAt: null, createdAt: now, contactPrivate: 'fixture-contact@example.org', icon: null },
  // Golden collect(clPoolManager, LTT1, 0, Safe) calldata from apps/api/test/payloads.test.ts.
  collect: {
    payload: {
      kind: 'safe', chainId: 4663, safe: '0x715a6176946aDbD22c1B2021d321Fb3767ca3432', to: '0x9c2c09EFBDb1726d3563B3f92F9912C9134f54aB', value: '0',
      data: '0x3c49be0c000000000000000000000000f4a28fa4cfecaef349a7d52fa1eb4df56eb22f660000000000000000000000002a21c0826848f2d597b7c87a4b931de1407958a60000000000000000000000000000000000000000000000000000000000000000000000000000000000000000715a6176946adbd22c1b2021d321fb3767ca3432',
      operation: 0, description: 'collect(0xf4a2…, 0x2a21…, all accrued, 0x715a…)',
      decoded: { functionName: 'collect', signature: 'collect(address,address,uint256,address)', args: [{ name: 'poolManager', type: 'address', value: '0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66' }, { name: 'currency', type: 'address', value: '0x2A21c0826848f2D597B7C87A4B931dE1407958A6' }, { name: 'amount', type: 'uint256', value: '0' }, { name: 'recipient', type: 'address', value: '0x715a6176946aDbD22c1B2021d321Fb3767ca3432' }] },
      warnings: [],
    },
    simulation: { status: 'unavailable', from: SAFE, to: FEE, blockNumber: null, returnData: null, revert: null, error: 'fixture: no chain behind the mock API', simulatedAt: now, method: 'eth_call' },
    simulatedFrom: SAFE,
  },
  flag: { payload: { kind: 'direct', chainId: 4663, from: '0x1bfb63db0ca9a647d9538715ce9ae36e16f4ea73', to: REGISTRY, value: '0', data: '0xefd3b1e5', description: 'setListing(hook, Malicious, reason)', decoded: null, warnings: [] }, simulation: { status: 'unavailable', error: 'fixture' }, simulatedFrom: '0x1bfb63db0ca9a647d9538715ce9ae36e16f4ea73', note: 'fixture' },
}
