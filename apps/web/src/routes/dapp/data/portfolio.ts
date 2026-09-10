/* ============================================================================
   Portfolio data — SCREENS.md § C5.
   MOCK SEAM: `loadPortfolio()`. Placeholder positions for a placeholder wallet.
   ============================================================================ */

export type PositionStatus = 'ACTIVE' | 'PENDING' | 'PAUSED'

export interface PortfolioKpi {
  label: string
  value: string
  sub: string
}

export interface Position {
  pair: string
  latch: string
  value: string
  fees: string
  status: PositionStatus
}

export interface PortfolioData {
  kpis: PortfolioKpi[]
  columns: string[]
  positions: Position[]
}

export function loadPortfolio(): PortfolioData {
  return {
    kpis: [
      { label: 'POSITION VALUE', value: '$1.94M', sub: '+$42.1K / 30d' },
      { label: 'FEES EARNED', value: '$61.2K', sub: '+8.4% vs no latch' },
      { label: 'ACTIVE LATCHES', value: '5', sub: 'across 3 networks' },
    ],
    columns: ['POSITION', 'LATCH', 'VALUE', 'FEES 30D', 'STATUS'],
    positions: [
      { pair: 'ETH / USDC 0.05%', latch: 'DynamicFeeLatch', value: '$812K', fees: '$24.1K', status: 'ACTIVE' },
      { pair: 'WBTC / ETH 0.30%', latch: 'JITLatch', value: '$466K', fees: '$14.8K', status: 'ACTIVE' },
      { pair: 'ETH / USDT 0.05%', latch: 'OracleLatch', value: '$318K', fees: '$11.2K', status: 'ACTIVE' },
      { pair: 'ARB / ETH 0.30%', latch: 'RewardLatch', value: '$204K', fees: '$7.4K', status: 'PENDING' },
      { pair: 'RWA-T / USDC 0.01%', latch: 'KYCGateLatch', value: '$142K', fees: '$3.7K', status: 'PAUSED' },
    ],
  }
}
