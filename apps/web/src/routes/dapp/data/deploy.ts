/* ============================================================================
   Deploy a Hook data — SCREENS.md § C3.
   MOCK SEAM: `loadDeploy()` plus `simulationLines()` / `preflightChecks()`,
   which stand in for the simulator's response. No transaction is ever signed
   or submitted: the "Register on Base ✓" state is a UI placeholder.
   ============================================================================ */

export interface DeployStep {
  n: string
  name: string
  hint: string
}

export interface PreflightCheck {
  name: string
  value: string
  ok: boolean
}

export interface DeployData {
  steps: DeployStep[]
  contractAddress: string
  callbacks: string[]
  /** README § State management: `cbs` default. */
  defaultCallbacks: string[]
  /** README § State management: `budget` default 24, max 60 (thousands of gas). */
  defaultBudget: number
  maxBudget: number
  minBudget: number
  /** Axis captions under the gas bar. */
  budgetAxis: [string, string]
}

export function loadDeploy(): DeployData {
  return {
    steps: [
      { n: '1', name: 'Contract', hint: 'address + ABI' },
      { n: '2', name: 'Callbacks', hint: 'permission bitmap' },
      { n: '3', name: 'Simulate', hint: 'replay mainnet' },
      { n: '4', name: 'Register', hint: 'sign + submit' },
    ],
    contractAddress: '0x71c2…9ef4',
    callbacks: [
      'beforeSwap',
      'afterSwap',
      'beforeAddLiquidity',
      'afterAddLiquidity',
      'beforeRemoveLiquidity',
      'afterDonate',
    ],
    defaultCallbacks: ['beforeSwap', 'afterSwap'],
    defaultBudget: 24,
    maxBudget: 60,
    minBudget: 2,
    budgetAxis: ['2k', '60k'],
  }
}

/** The six mono lines in the simulation output panel (SCREENS.md § C3). */
export function simulationLines(deployed: boolean): string[] {
  return [
    '→ compiling FeeLatch.sol',
    '✓ bytecode 4.2 KB · under 24 KB limit',
    '✓ permission bitmap 0x0003 accepted',
    '→ replaying 1,000 mainnet swaps',
    '✓ median overhead 8,412 gas',
    deployed ? '✓ ready to register on Base' : '· awaiting simulation',
  ]
}

/** PRE-FLIGHT CHECKS. "Gas within budget" fails below 9k (SCREENS.md § C3). */
export function preflightChecks(budget: number): PreflightCheck[] {
  const withinBudget = budget >= 9
  return [
    { name: 'Bytecode size', value: '4.2 KB', ok: true },
    { name: 'Reentrancy scan', value: 'clean', ok: true },
    {
      name: 'Gas within budget',
      value: withinBudget ? `8.4k / ${budget}k` : 'over budget',
      ok: withinBudget,
    },
    { name: 'Registry slot', value: 'available', ok: true },
  ]
}
