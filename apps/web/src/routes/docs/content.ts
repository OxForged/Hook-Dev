/**
 * Docs page content.
 *
 * LAYOUT, STRUCTURE, SECTION ORDER AND TONE come from
 * `latch design/SCREENS.md` § B.
 *
 * THE TECHNICAL CONTENT DOES NOT. SCREENS.md describes an `ILatch` /
 * `@latch/core` protocol with a separate registry, per-call gas budgets and a
 * `latch simulate` / `latch register` CLI. None of that exists. Every code
 * sample, bit value, error name and command below is instead taken from, and
 * verified against, the contracts in this repo:
 *
 *   packages/core/src/interfaces/IHooks.sol
 *   packages/core/src/pool-cl/interfaces/ICLHooks.sol
 *   packages/core/src/libraries/Hooks.sol
 *   packages/core/src/libraries/LPFeeLibrary.sol
 *   packages/core/src/pool-cl/libraries/CLHooks.sol
 *   packages/hooks/src/base/BaseCLHook.sol
 *   packages/cli/src (create-latch-hook, latch new|bitmap|devnet)
 *
 * The Solidity sample compiles against those interfaces under solc 0.8.26 with
 * via_ir, and every behavioural claim on the page is asserted by a forge test
 * run against the real Vault + CLPoolManager stack. See the report accompanying
 * this change for the proof harness.
 *
 * REGISTRY AND MARKETPLACE CONTENT describes the contract that is actually
 * deployed on Sepolia at the `registry` address in src/lib/chain.ts — the one
 * `/app/deploy` writes to and `/verify/:hookAddress` reads from. That contract
 * is `LatchHookRegistry` (its ABI is src/lib/abi/registry.ts; the chain answers
 * `hookCount()` and reverts `latchCount()`), so every error, function and limit
 * below is spelled the way the DEPLOYED contract spells it, and the limits were
 * read back with eth_call rather than copied from source. A rename of the
 * source to `LatchRegistry` is in progress in packages/registry; until it is
 * redeployed, the deployed names are the true ones and these docs keep them.
 *
 * VOCABULARY. "Latch" is the product noun; the contract-level noun is still
 * "hook", because that is what the upstream interfaces call it. The rule here
 * is product noun in prose, real identifier in code voice: a Latch is a hook
 * contract, and the registry reads its bitmap by calling
 * `getHooksRegistrationBitmap()` on it. Nothing inside a code sample, an error
 * name or an ABI reference is ever renamed.
 */

/* ------------------------------------------------------------------ anchors */

/**
 * Section ids, in document order.
 *
 * The reference HTML gives BOTH the "Quickstart" nav entry and the
 * "2 · Write the latch" section the id `#quickstart`, so two table-of-contents
 * rows resolve to the same heading. That is a bug in the prototype: SCREENS.md
 * § B2 lists them as separate entries. The intro keeps `#quickstart` (it is the
 * target of the header nav and of the "Back to quickstart" button) and step 2
 * gets its own `#write`.
 */
export const SECTION_IDS = [
  'quickstart',
  'install',
  'write',
  'deploy',
  'register',
  'verify',
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
   * existing anchors because "real pages [are] still to be written"
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
      { label: 'Encode & deploy', href: '#deploy', spy: true },
    ],
  },
  {
    title: 'MARKETPLACE',
    items: [
      { label: 'Register a Latch', href: '#register', spy: true },
      { label: 'Verification permalink', href: '#verify', spy: true },
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
      { label: 'Dynamic fees', href: '#write', spy: false },
      { label: 'Launch protection', href: '#write', spy: false },
      { label: 'Returns-delta Latches', href: '#interface', spy: false },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { label: 'Local devnet', href: '#install', spy: false },
      { label: 'Sepolia deployment', href: '#deploy', spy: false },
      { label: 'Audits', href: '#verify', spy: false },
    ],
  },
]

export type TocItem = { label: string; href: string }

export const TOC: TocItem[] = [
  { label: 'Quickstart', href: '#quickstart' },
  { label: '1 · Install', href: '#install' },
  { label: '2 · Write the latch', href: '#write' },
  { label: '3 · Encode and deploy', href: '#deploy' },
  { label: '4 · Register the Latch', href: '#register' },
  { label: 'Verification permalink', href: '#verify' },
  { label: 'Callback reference', href: '#interface' },
  { label: 'Execution order', href: '#lifecycle' },
  { label: 'Common errors', href: '#errors' },
]

/* ------------------------------------------------------------------- intro */

/**
 * packages/cli/package.json pins node >= 20; every contract here is solc 0.8.26
 * exactly. "LIVE ON" is the one entry in `DEPLOYMENTS` (src/lib/chain.ts).
 */
export const FACTS: { label: string; value: string }[] = [
  { label: 'TOOLCHAIN', value: 'Foundry + Node ≥ 20' },
  { label: 'SOLIDITY', value: '0.8.26' },
  { label: 'LIVE ON', value: 'Ethereum Sepolia' },
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

/**
 * The project name decides the contract name: `toContractName` in
 * packages/cli/src/commands/new.ts turns `fee-latch` into `FeeLatch`, which is
 * why the file below is `src/FeeLatch.sol` and the script is
 * `script/DeployFeeLatch.s.sol`. Change one and the other two follow.
 */
export const INSTALL_SHELL = `[[cmd:npx]] create-latch-hook fee-latch --template dynamic-fee
[[cmd:cd]] fee-latch
[[cmd:forge]] build`

/**
 * Verified: this exact contract compiles under solc 0.8.26 / via_ir against
 * packages/core and packages/hooks, with no warnings.
 */
export const FEE_LATCH_SOL = `[[com:// SPDX-License-Identifier: MIT]]
[[kw:pragma solidity]] 0.8.26;

[[kw:import]] {BaseCLHook} [[kw:from]] [[str:"latch-hooks/src/base/BaseCLHook.sol"]];
[[kw:import]] {ICLHooks} [[kw:from]] [[str:"infinity-core/src/pool-cl/interfaces/ICLHooks.sol"]];
[[kw:import]] {ICLPoolManager} [[kw:from]] [[str:"infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol"]];
[[kw:import]] {PoolKey} [[kw:from]] [[str:"infinity-core/src/types/PoolKey.sol"]];
[[kw:import]] {LPFeeLibrary} [[kw:from]] [[str:"infinity-core/src/libraries/LPFeeLibrary.sol"]];
[[kw:import]] {BeforeSwapDelta, BeforeSwapDeltaLibrary} [[kw:from]] [[str:"infinity-core/src/types/BeforeSwapDelta.sol"]];

[[kw:contract]] [[type:FeeLatch]] [[kw:is]] [[type:BaseCLHook]] {
    [[kw:uint24 constant]] LOW = [[num:500]];
    [[kw:uint24 constant]] HIGH = [[num:3000]];
    [[kw:int256 constant]] LARGE = [[num:10 ether]];

    [[kw:constructor]](ICLPoolManager _poolManager) [[type:BaseCLHook]](_poolManager) {}

    [[com:/// Bit 6 only. poolKey.parameters must carry exactly this value.]]
    [[kw:function]] [[fn:getHooksRegistrationBitmap]]() [[kw:public pure override returns]] (uint16) {
        [[kw:return]] BEFORE_SWAP;
    }

    [[kw:function]] [[fn:_beforeSwap]](address, PoolKey [[kw:calldata]], ICLPoolManager.SwapParams [[kw:calldata]] params, bytes [[kw:calldata]])
        [[kw:internal pure override returns]] (bytes4, BeforeSwapDelta, uint24)
    {
        [[com:// amountSpecified is negative for exact input, positive for exact output.]]
        [[kw:int256]] amount = params.amountSpecified;
        [[kw:uint24]] fee = (amount >= LARGE || amount <= -LARGE) ? HIGH : LOW;

        [[com:// OVERRIDE_FEE_FLAG is what makes core apply the fee, and it is read]]
        [[com:// only on a dynamic-fee pool. Return the selector or core reverts.]]
        [[kw:return]] (ICLHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}`

/**
 * Values taken from the real output of `latch bitmap beforeSwap`
 * (packages/cli), condensed from its table onto two lines.
 */
export const BITMAP_SHELL = `[[cmd:latch]] bitmap beforeSwap
[[com:bitmap    0x0040 · decimal 64 · callbacks beforeSwap]]
[[com:pool key  0x00000000000000000000000000000000000000000000000000000000003c0040]]`

export const DEPLOY_SHELL = `[[com:# Latch on Sepolia · chain 11155111]]
[[com:#   Vault           0xCe3d133eb486b448A53437A5073619FbE424d01B]]
[[com:#   BinPoolManager  0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3]]
[[com:#   FeeController   0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9]]
[[com:#   Create3Factory  0x76473D174Aa17C23FBE49CAb50aAc4ED4d8c678F]]

[[com:# the two the generated script actually reads]]
[[cmd:export]] PRIVATE_KEY=0x...
[[cmd:export]] CL_POOL_MANAGER=0xb7C8a11E0B359616eD06256783aF57114841F738

[[cmd:forge]] test
[[cmd:forge]] script script/DeployFeeLatch.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast`

/* ------------------------------------------------------------- registry */

/**
 * The deployed LatchHookRegistry — `DEPLOYMENTS[11155111].registry` in
 * src/lib/chain.ts. Everything the Latch Marketplace shows is read from it and
 * `/app/deploy` writes to it. Spelled out here so a reader can paste it into a
 * block explorer without opening the app.
 */
export const REGISTRY_ADDRESS_SEPOLIA = '0x665e7e5C419d004420C6Cb8c924E1E5Ca31F43DE'

/**
 * The same `register` call `/app/deploy` sends, from a shell. The struct is
 * `HookMetadata` in the deployed ABI: (name, description, sourceURI, auditURI,
 * chainIds). Verified: `cast calldata` on exactly this signature and tuple
 * literal decodes, via viem, to the expected `register` arguments.
 *
 * `\\` at a line end is a real backslash in the rendered snippet — a bare `\`
 * inside a template literal would be a JS line continuation and vanish.
 */
export const REGISTER_SHELL = `[[com:# LatchHookRegistry on Sepolia — the contract behind /app/marketplace]]
[[cmd:export]] REGISTRY=${REGISTRY_ADDRESS_SEPOLIA}
[[cmd:export]] HOOK=0x...   [[com:# the Latch you just deployed]]

[[com:# pre-flight: two of the checks register() itself performs]]
[[cmd:cast]] call $HOOK "getHooksRegistrationBitmap()(uint16)" --rpc-url $SEPOLIA_RPC_URL
[[cmd:cast]] call $REGISTRY "isRegistered(address)(bool)" $HOOK --rpc-url $SEPOLIA_RPC_URL

[[com:# register(hook, (name, description, sourceURI, auditURI, chainIds)) — irreversible]]
[[cmd:cast]] send $REGISTRY "register(address,(string,string,string,string,uint256[]))" $HOOK \\
  '("FeeLatch","Dynamic fee: 0.05% or 0.30% by swap size","https://github.com/you/fee-latch","",[11155111])' \\
  --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY`

/**
 * What `/app/deploy` does, in order. Each step is read off the screen's own
 * code: src/routes/dapp/screens/Deploy.tsx and src/routes/dapp/lib/registryWrite.ts.
 * The wallet layer is @latchprotocol/connect (RainbowKit + wagmi); the app
 * offers Sepolia only because it is the only chain in `DEPLOYMENTS`.
 */
export const REGISTER_STEPS: LifecycleStep[] = [
  {
    step: '01',
    name: 'Connect on Sepolia',
    note: 'Browser wallets, plus WalletConnect where the app is configured for it. On any other network the form offers a switch and nothing else.',
  },
  {
    step: '02',
    name: 'Paste the Latch address',
    note: 'The app checks for code, asks isRegistered, then reads getHooksRegistrationBitmap() under the registry’s own PROBE_GAS and classifies it with the registry’s pure functions.',
  },
  {
    step: '03',
    name: 'Describe the listing',
    note: 'Name, description, source and audit URIs, chain ids. Descriptive only: nothing you type can change the permissions recorded.',
  },
  {
    step: '04',
    name: 'Pre-flight',
    note: 'register() is simulated with eth_call at the current block. A revert is decoded by name and shown before anything is signed.',
  },
  {
    step: '05',
    name: 'Sign, then wait for the receipt',
    note: 'Only a receipt with status 1 is a success. The record lands as Unverified · Active and is in the Marketplace at once.',
  },
]

/**
 * Every custom error the deployed `register` can revert with, in the order the
 * function checks them (packages/registry, `register` + `_validateMetadata` +
 * `_probePermissions`). The numeric limits were read back from the deployed
 * contract with eth_call, not copied from source:
 *   MAX_NAME_BYTES 64 · MAX_DESCRIPTION_BYTES 2048 · MAX_URI_BYTES 512 ·
 *   MAX_CHAINS 32 · PROBE_GAS 100000 · PROBE_GAS_FLOOR 131587.
 */
export const REGISTRY_REJECTIONS: DocError[] = [
  {
    code: 'ZeroAddress()',
    fix: 'The hook argument is address(0). Pass the address of the deployed Latch.',
  },
  {
    code: 'HookAlreadyRegistered(address hook)',
    fix: 'A record already exists for that address. Registration happens once and there is no unregister. If it is yours, the steward can call updateMetadata or transferSteward; a curator can reassign a squatted listing.',
  },
  {
    code: 'HookHasNoCode(address hook)',
    fix: 'No bytecode at that address on Sepolia — an EOA, a typo, or a contract deployed on a different chain.',
  },
  {
    code: 'EmptyName()',
    fix: 'metadata.name is required. Everything else in the struct may be empty.',
  },
  {
    code: 'StringTooLong(uint256 length, uint256 maximum)',
    fix: 'name over 64 bytes, description over 2048, or sourceURI / auditURI over 512. The limits are bytes, not characters.',
  },
  {
    code: 'TooManyChains(uint256 count, uint256 maximum)',
    fix: 'metadata.chainIds has more than 32 entries. The list is informational; keep it to the chains the Latch is actually deployed on.',
  },
  {
    code: 'InsufficientGasForProbe(uint256 available, uint256 required)',
    fix: 'Less than PROBE_GAS_FLOOR (131,587) gas was left when the probe started. Raise the transaction gas limit — this is about your call, not your Latch.',
  },
  {
    code: 'PermissionsUnreadable(address hook)',
    fix: 'getHooksRegistrationBitmap() reverted, returned anything other than one 32-byte word, returned a value above uint16, or ran past PROBE_GAS (100,000). Core makes the same call at initialize, so such a Latch cannot back a pool either.',
  },
  {
    code: 'ReservedBitsSet(uint16 permissions)',
    fix: 'The bitmap sets bit 14 or 15, which ICLHooks does not assign. Core rejects the same bitmap at initialize.',
  },
  {
    code: 'PermissionDependencyMissing(uint16 permissions)',
    fix: 'A *ReturnsDelta bit without the callback that returns the delta. A Latch built on BaseCLHook cannot reach this — its constructor rejects the same bitmap at deploy time.',
  },
]

/* ---------------------------------------------------------------- surfaces */

export type Surface = { route: string; wallet: string; reads: string }

/**
 * The four web surfaces that touch the registry. Routes from src/App.tsx and
 * src/routes/dapp/index.tsx; `/app/explorer` is a redirect to `/app/marketplace`.
 * None of the read surfaces gate on a wallet: they use the public client in
 * src/lib/chain.ts. Only `/app/deploy` needs a signer.
 */
export const SURFACES: Surface[] = [
  {
    route: '/app/marketplace',
    wallet: 'not needed',
    reads: 'Every record. Filter by verification level and capability class; flagged listings are shown apart and no filter hides them.',
  },
  {
    route: '/app/marketplace/:address',
    wallet: 'not needed',
    reads: 'One record in full, with a link to its public permalink.',
  },
  {
    route: '/app/deploy',
    wallet: 'required · Sepolia',
    reads: 'Probes the Latch, simulates register(), then signs it.',
  },
  {
    route: '/verify/:hookAddress',
    wallet: 'none — no app chrome',
    reads: 'One record, or an unmistakable NOT REGISTERED. Built to be linked from your own site.',
  },
]

/* ------------------------------------------------------ callback reference */

export type Callback = { name: string; bit: string; returns: string }

/**
 * Bit offsets are declared in packages/core/src/pool-cl/interfaces/ICLHooks.sol
 * and mirrored as masks in packages/hooks/src/base/BaseCLHook.sol.
 * The last four are not callbacks: they authorise the matching callback's delta
 * return, and core rejects one without its base callback.
 */
export const CALLBACKS: Callback[] = [
  { name: 'beforeInitialize', bit: '0x0001', returns: 'bytes4' },
  { name: 'afterInitialize', bit: '0x0002', returns: 'bytes4' },
  { name: 'beforeAddLiquidity', bit: '0x0004', returns: 'bytes4' },
  { name: 'afterAddLiquidity', bit: '0x0008', returns: 'bytes4, BalanceDelta' },
  { name: 'beforeRemoveLiquidity', bit: '0x0010', returns: 'bytes4' },
  { name: 'afterRemoveLiquidity', bit: '0x0020', returns: 'bytes4, BalanceDelta' },
  { name: 'beforeSwap', bit: '0x0040', returns: 'bytes4, BeforeSwapDelta, uint24' },
  { name: 'afterSwap', bit: '0x0080', returns: 'bytes4, int128' },
  { name: 'beforeDonate', bit: '0x0100', returns: 'bytes4' },
  { name: 'afterDonate', bit: '0x0200', returns: 'bytes4' },
  { name: 'beforeSwapReturnsDelta', bit: '0x0400', returns: '—' },
  { name: 'afterSwapReturnsDelta', bit: '0x0800', returns: '—' },
  { name: 'afterAddLiquidityReturnsDelta', bit: '0x1000', returns: '—' },
  { name: 'afterRemoveLiquidityReturnsDelta', bit: '0x2000', returns: '—' },
]

/* --------------------------------------------------------- execution order */

export type LifecycleStep = { step: string; name: string; note: string }

export const LIFECYCLE: LifecycleStep[] = [
  {
    step: '01',
    name: 'A router locks the Vault',
    note: 'Only the lock holder may call swap. It becomes the callback’s sender.',
  },
  {
    step: '02',
    name: 'beforeSwap runs',
    note: 'Only if bit 6 is set in poolKey.parameters. Reverting here blocks the swap.',
  },
  {
    step: '03',
    name: 'The fee override is read',
    note: 'Only if the pool fee is 0x800000 and OVERRIDE_FEE_FLAG is set on the return.',
  },
  {
    step: '04',
    name: 'The swap executes',
    note: 'Bit 10 lets beforeSwap resize the amount before the pool sees it.',
  },
  {
    step: '05',
    name: 'afterSwap runs, deltas settle',
    note: 'Selectors are checked; balances settle when the lock is released.',
  },
]

/* ---------------------------------------------------------- common errors */

export type DocError = { code: string; fix: string }

/** All four are declared in packages/core/src/libraries/Hooks.sol or BaseCLHook.sol. */
export const ERRORS: DocError[] = [
  {
    code: 'HookConfigValidationError()',
    fix: 'poolKey.parameters and getHooksRegistrationBitmap() disagree. Hooks.validateHookConfig compares them at initialize — make both sides the same number.',
  },
  {
    code: 'HookPermissionsValidationError()',
    fix: 'A *ReturnsDelta bit was declared without the callback that returns it. BaseCLHook catches the same mistake at deploy time as PermissionDependencyMissing.',
  },
  {
    code: 'HookNotImplemented()',
    fix: 'You declared a permission but never overrode the matching internal hook on BaseCLHook. Implement it, or drop the bit from the bitmap.',
  },
  {
    code: 'InvalidHookResponse()',
    fix: 'The callback returned the wrong selector or the wrong number of words. Return ICLHooks.<fn>.selector, or use the BaseCLHook passthrough helpers.',
  },
]
