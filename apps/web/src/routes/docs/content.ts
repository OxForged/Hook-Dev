/**
 * Docs page content — every string here is transcribed verbatim from
 * `latch design/SCREENS.md` § B (Docs), cross-checked against
 * `design-references/Latch Docs.dc.html`.
 *
 * Nothing in this module is invented. If a value needs to change, change the
 * spec first.
 *
 * NOTE ON THE CODE SAMPLES: they describe an `ILatch` / `@latch/core`
 * interface that does not exist in `packages/core` or `packages/hooks` (which
 * ship a PancakeSwap-infinity-style `IHooks.getHooksRegistrationBitmap()`).
 * SCREENS.md is the spec for this page, so the samples are reproduced exactly
 * as specified and the divergence is reported to the maintainers rather than
 * silently "fixed" here.
 */

/* ------------------------------------------------------------------ anchors */

/**
 * Section ids, in document order.
 *
 * The reference HTML gives BOTH the "Quickstart" nav entry and the
 * "2 · Write the latch" section the id `#quickstart`, so two different table
 * of contents rows resolve to the same heading. That is a bug in the
 * prototype: SCREENS.md § B2 lists them as separate entries. The intro keeps
 * `#quickstart` (it is the target of the header nav and of the "Back to
 * quickstart" button) and step 2 gets its own `#write`.
 */
export const SECTION_IDS = [
  'quickstart',
  'install',
  'write',
  'register',
  'interface',
  'lifecycle',
  'errors',
] as const

export type SectionId = (typeof SECTION_IDS)[number]

/* --------------------------------------------------------------- left rail */

export type RailItem = {
  label: string
  href: string
  /**
   * Whether scroll-spy may light this row. GUIDES and OPERATIONS point back at
   * quickstart anchors because "real pages [are] still to be written"
   * (SCREENS.md § B2), so they must not compete with the rows that genuinely
   * mirror the heading hierarchy.
   */
  spy: boolean
}

export type RailGroup = { title: string; items: RailItem[] }

export const RAIL_GROUPS: RailGroup[] = [
  {
    title: 'GET STARTED',
    items: [
      { label: 'Quickstart', href: '#quickstart', spy: true },
      { label: 'Install', href: '#install', spy: true },
      { label: 'Simulate & register', href: '#register', spy: true },
    ],
  },
  {
    title: 'REFERENCE',
    items: [
      { label: 'Callbacks', href: '#interface', spy: true },
      { label: 'Execution order', href: '#lifecycle', spy: true },
      { label: 'Errors', href: '#errors', spy: true },
    ],
  },
  {
    title: 'GUIDES',
    items: [
      { label: 'Dynamic fees', href: '#quickstart', spy: false },
      { label: 'JIT liquidity', href: '#quickstart', spy: false },
      { label: 'Compliance gating', href: '#quickstart', spy: false },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { label: 'Gas sponsorship', href: '#register', spy: false },
      { label: 'Verification', href: '#errors', spy: false },
      { label: 'Audits', href: '#errors', spy: false },
    ],
  },
]

export type TocItem = { label: string; href: string }

export const TOC: TocItem[] = [
  { label: 'Quickstart', href: '#quickstart' },
  { label: '1 · Install', href: '#install' },
  { label: '2 · Write the latch', href: '#write' },
  { label: '3 · Simulate and register', href: '#register' },
  { label: 'Callback reference', href: '#interface' },
  { label: 'Execution order', href: '#lifecycle' },
  { label: 'Common errors', href: '#errors' },
]

/* ------------------------------------------------------------------- intro */

export const FACTS: { label: string; value: string }[] = [
  { label: 'TOOLCHAIN', value: 'Foundry ≥ 0.2' },
  { label: 'SOLIDITY', value: '^0.8.26' },
  { label: 'TIME TO FIRST LATCH', value: '~20 min' },
]

/* ------------------------------------------------------------ code samples */

/*
 * Highlighting markup: `[[kind:text]]`. See `highlight.ts`. Everything outside
 * a marker renders in the default code ink. Kinds map onto the palette the
 * README fixes: kw → Code Keyword #C56BFF, type → Amber #FFD166,
 * fn → Signal Blue #4A9BFF, str/num/cmd → Success #5FD39A,
 * com → Code Comment #6D80A0.
 *
 * README § "Code block rule" explicitly permits a real <pre><code> with
 * preserved whitespace instead of the prototype's per-line <div> +
 * padding-left, so indentation here is real 4-space Solidity indentation.
 */

export const INSTALL_SHELL = `[[cmd:forge]] install latch-protocol/core
[[cmd:forge]] remappings > remappings.txt`

export const FEE_LATCH_SOL = `[[com:// SPDX-License-Identifier: MIT]]
[[kw:pragma solidity]] ^0.8.26;

[[kw:import]] {ILatch, PoolKey, SwapParams} [[kw:from]] [[str:"@latch/core/ILatch.sol"]];
[[kw:import]] {BEFORE_SWAP, AFTER_SWAP} [[kw:from]] [[str:"@latch/core/Permissions.sol"]];

[[kw:contract]] [[type:FeeLatch]] [[kw:is]] [[type:ILatch]] {
    [[kw:uint24 constant]] LOW = [[num:500]];
    [[kw:uint24 constant]] HIGH = [[num:3000]];

    [[kw:function]] [[fn:permissions]]() [[kw:external pure returns]] (uint16) {
        [[kw:return]] BEFORE_SWAP | AFTER_SWAP;
    }

    [[kw:function]] [[fn:beforeSwap]](PoolKey [[kw:calldata]] key, SwapParams [[kw:calldata]] p)
        [[kw:external override returns]] (uint24 fee)
    {
        fee = volatility(key) > p.threshold ? HIGH : LOW;
    }
}`

export const REGISTER_SHELL = `[[cmd:latch]] simulate --contract FeeLatch --pool ETH/USDC --runs 1000
[[com:median overhead 8,412 gas · 0 reverts · bitmap 0x0003 ok]]

[[cmd:latch]] register --network base-sepolia --budget 24000`

/* ------------------------------------------------------ callback reference */

export type Callback = { name: string; bit: string; returns: string }

export const CALLBACKS: Callback[] = [
  { name: 'beforeSwap', bit: '0x0001', returns: 'uint24 fee' },
  { name: 'afterSwap', bit: '0x0002', returns: '—' },
  { name: 'beforeAddLiquidity', bit: '0x0004', returns: 'bool allow' },
  { name: 'afterAddLiquidity', bit: '0x0008', returns: '—' },
  { name: 'beforeRemoveLiquidity', bit: '0x0010', returns: 'bool allow' },
  { name: 'afterDonate', bit: '0x0020', returns: '—' },
]

/* --------------------------------------------------------- execution order */

export type LifecycleStep = { step: string; name: string; note: string }

export const LIFECYCLE: LifecycleStep[] = [
  { step: '01', name: 'Pool receives a swap', note: 'Router calls the pool as usual.' },
  {
    step: '02',
    name: 'beforeSwap latches run',
    note: 'In registration order, each within its gas budget.',
  },
  { step: '03', name: 'Swap executes', note: 'Using the fee returned by the last latch.' },
  {
    step: '04',
    name: 'afterSwap latches run',
    note: 'Side effects only; return values ignored.',
  },
  { step: '05', name: 'Registry records the call', note: 'Gas used, reverts and fee applied.' },
]

/* ---------------------------------------------------------- common errors */

export type DocError = { code: string; fix: string }

export const ERRORS: DocError[] = [
  {
    code: 'LatchBitmapMismatch()',
    fix: 'permissions() declares a callback the contract does not implement. Align the bitmap with your functions.',
  },
  {
    code: 'GasBudgetExceeded(uint256 used)',
    fix: 'The callback used more gas than the registered budget. Raise the budget or trim state writes.',
  },
  {
    code: 'LatchNotVerified()',
    fix: 'The pool requires verified latches. Submit source for verification, or attach to a permissionless pool.',
  },
  {
    code: 'ReentrantLatchCall()',
    fix: 'The latch re-entered the pool. Route external calls through afterSwap instead.',
  },
]
