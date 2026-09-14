/* Response shapes of apps/api/src/admin/service.ts and http/adminRoutes.ts. All integers are strings. */

export interface Alert {
  id: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  category: string
  chainId: number | null
  title: string
  detail: string
  subject: string | null
  provenance: string
  action: { label: string; page: string } | null
}

export type SeverityCounts = Record<Alert['severity'], number>

export interface TokenTotal {
  token: string
  symbol: string | null
  raw: string
  units: string | null
}

export interface Overview {
  chainId: number
  generatedAt: string
  indexer: { indexed: false } | { indexed: true; lastIndexedBlock: string; lastIndexedBlockTimestamp: string; headBlock: string; headObservedAt: string; lagBlocks: string; contractBlockNumber: string | null; contractClockReadAt: string | null }
  alerts: { counts: SeverityCounts; top: Alert[] }
  revenue: {
    provenance: string
    received: TokenTotal[]
    uncollectedAccrued: (TokenTotal & { poolManager: string; readAtBlock: string; readAt: string })[]
    notDeployed: { source: string; label: string; note: string }[]
  }
  moderation: Record<string, number>
  apiKeys: { byStatus: Record<string, number>; requestsThisMonth: string; period: string }
}

export interface DecodedCall {
  functionName: string
  signature: string
  args: { name: string; type: string; value: string | string[] }[]
}

export interface TimelockOperation {
  chainId: number
  timelock: string
  tier: string
  operationId: string
  status: 'PENDING' | 'READY' | 'EXECUTED' | 'CANCELLED'
  scheduledAt: { blockNumber: string; blockTimestamp: string; txHash: string }
  delaySeconds: string | null
  readyAt: string | null
  executedAt: { blockNumber: string; blockTimestamp: string; txHash: string } | null
  cancelledAt: { blockNumber: string; blockTimestamp: string; txHash: string } | null
  salt: string | null
  predecessor: string | null
  calls: { index: number; target: string; value: string; data: string; selector: string | null; functionSignature: string | null; decoded: DecodedCall | null; roleName: string | null; hazard: string | null; hazardNote: string | null }[]
  hazards: string[]
}

export interface SimulationResult {
  status: 'success' | 'reverted' | 'unavailable'
  from?: string
  to?: string
  blockNumber?: string | null
  returnData?: string | null
  revert?: { name: string | null; args: string[]; raw: string | null; message: string } | null
  error?: string | null
  simulatedAt?: string
}

export interface TxPayload {
  kind: 'safe' | 'direct'
  chainId: number
  safe?: string
  from?: string
  to: string
  value: string
  data: string
  operation?: number
  description: string
  decoded: DecodedCall | null
  warnings: string[]
}

/* ---- treasury conversion (apps/api/src/admin/treasury/service.ts) ---- */

export interface TreasuryPolicy {
  maxPriceImpactBps: number
  slippageBps: number
  minValueWei: string
  deadlineSeconds: number
  maxQuoteAgeSeconds: number
}

export type TreasuryView =
  | { chainId: number; configured: false; message: string }
  | {
      chainId: number
      configured: true
      safe: string
      safeAppUrl: string | null
      target: { currency: string; symbol: string; name: string; balance: { wei: string; units: string } | null; balanceError: string | null }
      policy: TreasuryPolicy
      venue: string
      readAtBlock: string | null
      readAt: string | null
      inflowsProvenance: string
      indexed: boolean
      allowlistNote: string
      tokens: {
        token: string
        symbol: string
        decimals: number
        rationale: string
        alertBalanceRaw: string | null
        balance: { raw: string; units: string; onChainSymbol: string | null; onChainDecimals: number; mismatch: string | null } | null
        balanceError: string | null
        inflows: { raw: string; units: string; entries: number; bySource: { source: string; raw: string; entries: number }[] }
        usd: null | { usdPerToken: string | null; reason?: string; source?: string; feed?: string; feedUpdatedAt?: string; readAt?: string; method?: string }
      }[]
    }

export type HookVerdict = { ok: true; hook: string | null; basis: string; warnings: string[] } | { ok: false; hook: string; reason: string }

export interface RouteCandidateView {
  routeId: string
  end: 'native' | 'weth'
  hops: { poolId: string; currencyIn: string; currencyOut: string; zeroForOne: boolean; hooks: string | null; fee: number; hook: HookVerdict; slot0: { sqrtPriceX96: string; tick: number; protocolFee: number; lpFee: number } | { error: string } | null }[]
  quote: { amountOut: string; gasEstimate: string } | null
  impact: { midOut: string; feeAdjustedMidOut: string; priceImpactBps: number; totalCostBps: number; swapFeesPips: number[] } | null
  refusals: string[]
}

export interface RouteView {
  chainId: number
  token: string
  symbol: string
  decimals: number
  status: 'route' | 'no-route' | 'no-acceptable-route' | 'unavailable'
  message: string
  amountIn: string
  amountInUnits: string
  amountSource: 'requested' | 'safe-balance' | 'probe-one-token'
  safeBalance: string | null
  readAtBlock: string | null
  quotedAt: string | null
  contractClock: { contractBlockNumber: string; method: string } | null
  consideredPools: number
  best: (RouteCandidateView & { minOut: string; minOutUnits: string; blockers: string[] }) | null
  candidates: RouteCandidateView[]
  policy: TreasuryPolicy
  venue: string
}

export interface ConversionInnerCall {
  index: number
  label: string
  to: string
  value: string
  operation: number
  data: string
  decoded: DecodedCall | null
  router: { deadline: string | null; steps: { command: string; commandByte: string; actions?: { action: string; actionByte: string; params: Record<string, unknown> }[]; params?: Record<string, string> }[] } | null
}

export interface ConversionSimulation {
  method: string
  status: 'success' | 'reverted' | 'unavailable'
  from: string
  blockNumber: string
  simulatedAt: string
  nativeBalanceBefore: string | null
  nativeBalanceAfter: string | null
  nativeReceived: string | null
  meetsMinOut: boolean | null
  revert: { name: string | null; args: string[]; raw: string | null; message: string } | null
  error: string | null
  safe: { version: string | null; guard: string | null; error: string | null }
  simulated: string[]
  notSimulated: string[]
  steps: { index: number; status: string; detail: string }[] | null
}

export interface ConversionPrepared {
  payload: TxPayload & { innerCalls: ConversionInnerCall[] }
  route: RouteView
  quote: { amountIn: string; amountOut: string; minOut: string; minOutUnits: string; slippageBps: number; priceImpactBps: number; totalCostBps: number; readAtBlock: string; quotedAt: string; deadline: string; deadlineAt: string }
  simulation: ConversionSimulation
  multiSendCallOnly: { address: string; version: string; codeHash: string; verifiedAtBlock: string }
  safeAppUrl: string | null
  note: string
}
