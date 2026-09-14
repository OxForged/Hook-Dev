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
