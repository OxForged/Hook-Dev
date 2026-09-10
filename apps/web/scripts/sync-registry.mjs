/**
 * Derives the web app's view of LatchHookRegistry from the CONTRACT SOURCE, so the
 * two can never drift.
 *
 * `packages/registry/src/ILatchHookRegistry.sol` and `LatchHookRegistry.sol` are the
 * single source of truth for four things the Hook Explorer cannot invent:
 *
 *   1. The permission bit layout (`PERM_*`) — which bit is `beforeSwapReturnsDelta`.
 *   2. The masks `classify()` actually branches on — so the UI's local mirror of a
 *      pure on-chain function is built from the same constants the function is,
 *      rather than from a second hand-typed copy of them.
 *   3. Enum member order — `Verification`/`Listing`/`RiskClass` cross the ABI as
 *      `uint8`, and an off-by-one here would label an unverified hook "Audited".
 *   4. The ABI of every read the explorer performs.
 *
 * Cross-check: the same bit layout also lives in `packages/sdk/src/hooks/bitmap.ts`
 * (`CL_HOOK_FLAGS`), which is the SDK's verified table. This script reads BOTH and
 * refuses to emit anything if they disagree — a bitmap described two ways is the
 * exact failure the registry's own comments call out.
 *
 * Why parse rather than import: the web app is not in an npm workspace with either
 * package (see sync-chains.mjs for the same constraint), there is no committed forge
 * artifact to read an ABI out of, and `bitmap.ts` uses `.js` specifiers that Node's
 * type-stripping loader will not resolve to `.ts`. So both files are read as text and
 * parsed. Every extraction below is assertive: a missing or unexpected match exits
 * non-zero rather than emitting a half-built module.
 *
 * Run by `predev` / `prebuild`; also `npm run sync-registry`.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ifacePath = resolve(here, '../../../packages/registry/src/ILatchHookRegistry.sol')
const implPath = resolve(here, '../../../packages/registry/src/LatchHookRegistry.sol')
const sdkBitmapPath = resolve(here, '../../../packages/sdk/src/hooks/bitmap.ts')
const outFile = resolve(here, '../src/data/registry.generated.ts')

function fail(message) {
  console.error(`[sync-registry] ${message}`)
  process.exit(1)
}

for (const p of [ifacePath, implPath, sdkBitmapPath]) {
  if (!existsSync(p)) fail(`source of truth not found: ${p}`)
}

const iface = await readFile(ifacePath, 'utf8')
const impl = await readFile(implPath, 'utf8')
const sdkBitmap = await readFile(sdkBitmapPath, 'utf8')

/** Strips `//` and block comments so field/member scans never see prose. */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/* ------------------------------------------------------- 1. permission bits */

/**
 * Evaluates the right-hand side of a `uint16 constant PERM_X = ...;` declaration.
 * The grammar in the interface is tiny — `uint16(1) << 4`, `uint16(0xC000)`, and
 * `A | B | C` over previously declared constants — so the expression is whitelisted
 * character-by-character before it is evaluated, and identifiers must already be known.
 */
function evalPermExpr(expr, known) {
  const cleaned = expr.replace(/uint16\s*\(/g, '(').replace(/\s+/g, ' ').trim()
  if (!/^[0-9a-fA-FxX_|<>() ]*$/.test(cleaned.replace(/PERM_[A-Z_0-9]+/g, ''))) {
    fail(`unsupported constant expression: ${expr}`)
  }
  const substituted = cleaned.replace(/PERM_[A-Z_0-9]+/g, (name) => {
    if (!(name in known)) fail(`constant ${name} used before it is declared`)
    return String(known[name])
  })
  let value
  try {
    // eslint-disable-next-line no-new-func
    value = Function(`"use strict"; return (${substituted});`)()
  } catch (error) {
    fail(`could not evaluate ${expr}: ${error.message}`)
  }
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    fail(`constant ${expr} did not evaluate to a uint16 (got ${value})`)
  }
  return value
}

const PERMS = {}
for (const m of decomment(iface).matchAll(/uint16\s+constant\s+(PERM_[A-Z_0-9]+)\s*=\s*([^;]+);/g)) {
  PERMS[m[1]] = evalPermExpr(m[2], PERMS)
}
if (Object.keys(PERMS).length === 0) fail('no PERM_* constants found in ILatchHookRegistry.sol')

/** `PERM_BEFORE_SWAP_RETURNS_DELTA` -> `beforeSwapReturnsDelta`. */
const camel = (constName) =>
  constName
    .replace(/^PERM_/, '')
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c) => c.toUpperCase())

/** Single-bit constants, in bit order. These are the fourteen callbacks. */
const bits = Object.entries(PERMS)
  .filter(([, value]) => value !== 0 && (value & (value - 1)) === 0)
  .map(([name, value]) => ({ constName: name, mask: value, offset: Math.log2(value) }))
  .sort((a, b) => a.offset - b.offset)
  .map((b) => ({ ...b, name: camel(b.constName) }))

if (bits.length !== 14) fail(`expected 14 single-bit PERM_* constants, found ${bits.length}`)
bits.forEach((b, i) => {
  if (b.offset !== i) fail(`permission bits are not contiguous from 0: ${b.constName} is bit ${b.offset}`)
})

/* ---------------------------- 2. cross-check against the SDK's verified table */

const clFlagsBlock = /export const CL_HOOK_FLAGS = \{([\s\S]*?)\} as const/.exec(sdkBitmap)
if (!clFlagsBlock) fail('CL_HOOK_FLAGS not found in packages/sdk/src/hooks/bitmap.ts')

const sdkFlags = {}
for (const m of clFlagsBlock[1].matchAll(/(\w+)\s*:\s*(\d+)\s*,/g)) {
  sdkFlags[m[1]] = Number(m[2])
}

const drift = []
for (const bit of bits) {
  const sdkOffset = sdkFlags[bit.name]
  if (sdkOffset === undefined) drift.push(`${bit.name}: absent from the SDK's CL_HOOK_FLAGS`)
  else if (sdkOffset !== bit.offset) {
    drift.push(`${bit.name}: registry says bit ${bit.offset}, SDK says bit ${sdkOffset}`)
  }
}
for (const name of Object.keys(sdkFlags)) {
  if (!bits.some((b) => b.name === name)) drift.push(`${name}: in the SDK's table but not in the registry`)
}
if (drift.length > 0) {
  fail(
    'the registry and the SDK disagree about the hook permission bitmap:\n  - ' +
      drift.join('\n  - ') +
      '\nOne bitmap must not be describable two ways. Reconcile the sources before building.',
  )
}

/* ---------------------------------------------------------------- 3. enums */

function parseEnum(source, name) {
  const m = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(decomment(source))
  if (!m) fail(`enum ${name} not found`)
  const members = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (members.length === 0) fail(`enum ${name} parsed as empty`)
  return members
}

const ENUMS = {
  Verification: parseEnum(iface, 'Verification'),
  Listing: parseEnum(iface, 'Listing'),
  RiskClass: parseEnum(iface, 'RiskClass'),
}

/* --------------------------------------------------------------- 4. structs */

const STRUCTS = {}
for (const m of decomment(iface).matchAll(/struct\s+(\w+)\s*\{([^}]*)\}/g)) {
  const fields = m[2]
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((field) => {
      const parts = field.split(/\s+/)
      if (parts.length < 2) fail(`could not parse struct field "${field}" in ${m[1]}`)
      return { type: parts[0], name: parts[parts.length - 1] }
    })
  STRUCTS[m[1]] = fields
}

/** Solidity type -> ABI component. Enums cross as uint8, structs as tuples. */
function abiType(solidityType, name) {
  const arraySuffix = solidityType.endsWith('[]') ? '[]' : ''
  const base = arraySuffix ? solidityType.slice(0, -2) : solidityType

  if (base in ENUMS) {
    return { name, type: `uint8${arraySuffix}`, internalType: `enum ${base}${arraySuffix}` }
  }
  if (base in STRUCTS) {
    return {
      name,
      type: `tuple${arraySuffix}`,
      internalType: `struct ${base}${arraySuffix}`,
      components: STRUCTS[base].map((f) => abiType(f.type, f.name)),
    }
  }
  if (!/^(address|bool|string|bytes|bytes\d+|u?int\d*)$/.test(base)) {
    fail(`unmapped Solidity type "${solidityType}"`)
  }
  return { name, type: solidityType, internalType: solidityType }
}

/* ----------------------------------------------------------------- 5. reads */

/**
 * The explorer is read-only, so only views and pures are emitted. Anything that
 * writes to the registry is deliberately absent from this ABI: a UI that cannot
 * encode `setListing` cannot be tricked into sending it.
 */
const READS = [
  'hookCount',
  'hookAt',
  'listHooks',
  'getHook',
  'permissionsOf',
  'statusOf',
  'riskClassOf',
  'isAudited',
  'isRegistered',
  'classify',
  'decodePermissions',
  'takesSwapCut',
  'returnsDelta',
  'canBlockSwaps',
  'canTrapLiquidity',
  'isValidBitmap',
]

/** Grabs `function name(...) ... returns (...)` as one flat line, comments removed. */
function functionSignature(source, name) {
  const start = new RegExp(`\\n\\s*function\\s+${name}\\s*\\(`).exec(source)
  if (!start) fail(`function ${name}() not found in LatchHookRegistry.sol`)
  const from = start.index
  const bodyStart = source.indexOf('{', from + start[0].length)
  if (bodyStart === -1) fail(`function ${name}() has no body`)
  return decomment(source.slice(from, bodyStart)).replace(/\s+/g, ' ').trim()
}

/** `address hook, uint256 offset` -> ABI components. Drops data-location keywords. */
function parseParams(list) {
  const trimmed = list.replace(/\s+/g, ' ').trim()
  if (trimmed === '') return []
  return trimmed.split(',').map((raw) => {
    const words = raw.trim().split(/\s+/)
    const indexed = words.includes('indexed')
    const parts = words.filter((p) => !['memory', 'calldata', 'storage', 'indexed'].includes(p))
    if (parts.length === 0) fail(`empty parameter in "${list}"`)
    const type = parts[0]
    const name = parts.length > 1 ? parts[parts.length - 1] : ''
    const component = abiType(type, name)
    return indexed ? { ...component, indexed: true } : component
  })
}

const readAbi = READS.map((name) => {
  const sig = functionSignature(impl, name)
  const m = /^function\s+\w+\s*\(([^)]*)\)([^(]*)(?:returns\s*\(([\s\S]*)\)\s*)?$/.exec(sig)
  if (!m) fail(`could not parse the signature of ${name}(): ${sig}`)
  const modifiers = m[2]
  const stateMutability = modifiers.includes('pure') ? 'pure' : 'view'
  if (!modifiers.includes('pure') && !modifiers.includes('view')) {
    fail(`${name}() is neither view nor pure; this ABI is read-only by design`)
  }
  return {
    type: 'function',
    name,
    inputs: parseParams(m[1]),
    outputs: parseParams(m[3] ?? ''),
    stateMutability,
  }
})

/** Custom errors, so a revert decodes to `HookNotRegistered` and not to a hex blob. */
const errorAbi = []
for (const m of decomment(iface).matchAll(/error\s+(\w+)\s*\(([^)]*)\);/g)) {
  errorAbi.push({ type: 'error', name: m[1], inputs: parseParams(m[2]) })
}
if (errorAbi.length === 0) fail('no custom errors found in ILatchHookRegistry.sol')

/**
 * Events. Not optional decoration: a `Malicious` listing carries its REASON only in
 * `HookListingChanged`, never in storage, so a UI that shows a tombstone without the
 * reason has to read logs to get it.
 */
const eventAbi = []
for (const m of decomment(iface).matchAll(/event\s+(\w+)\s*\(([\s\S]*?)\)\s*;/g)) {
  eventAbi.push({ type: 'event', name: m[1], inputs: parseParams(m[2]), anonymous: false })
}
if (!eventAbi.some((e) => e.name === 'HookListingChanged')) {
  fail('HookListingChanged not found — the tombstone reason string has no other source')
}

/* ------------------------------------------------------- 6. derived risk sets */

const maskMembers = (maskName) => {
  if (!(maskName in PERMS)) fail(`mask ${maskName} not found`)
  return bits.filter((b) => (PERMS[maskName] & b.mask) !== 0).map((b) => b.name)
}

/* ------------------------------------------------------------------- 7. emit */

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const hex = (n) => `0x${n.toString(16).padStart(4, '0')}`

const abiLiteral = JSON.stringify([...readAbi, ...eventAbi, ...errorAbi], null, 2)
  .replace(/"([^"]+)":/g, '$1:')
  .replace(/"/g, "'")
  .split('\n')
  .map((line, i) => (i === 0 ? line : `  ${line}`))
  .join('\n')

const source = `/* eslint-disable */
/* ============================================================================
   GENERATED FILE — DO NOT EDIT BY HAND.

   Emitted by apps/web/scripts/sync-registry.mjs from
   packages/registry/src/ILatchHookRegistry.sol and LatchHookRegistry.sol,
   cross-checked bit for bit against packages/sdk/src/hooks/bitmap.ts
   (\`CL_HOOK_FLAGS\`). Generation FAILS if the two disagree.

   Everything here is contract fact: the bit layout, the masks \`classify()\`
   branches on, the order the three enums cross the ABI in as \`uint8\`, and the
   ABI of every read the Hook Explorer performs (reads only — this ABI cannot
   encode a state-changing call).

   Editorial copy — what a bit means for a user's money — is NOT here. It lives
   in src/routes/dapp/data/registry.ts, keyed by the \`HookCallback\` union
   below, so adding a callback to the contract breaks the build until someone
   writes the sentence explaining it.

   Regenerate with \`npm run sync-registry\`; \`predev\` and \`prebuild\` do it.

   NOTE: presence here means "the contract exists in this repo", NOT "the
   registry is deployed". It is deployed nowhere. See registry.ts.
   ============================================================================ */

/** Every callback the registration bitmap can carry, in bit order. */
export const HOOK_CALLBACKS = [
${bits.map((b) => `  ${q(b.name)},`).join('\n')}
] as const

export type HookCallback = (typeof HOOK_CALLBACKS)[number]

/** Bit offset of each callback. Mirrors \`PERM_*\` in ILatchHookRegistry.sol. */
export const HOOK_CALLBACK_BIT: Readonly<Record<HookCallback, number>> = {
${bits.map((b) => `  ${b.name}: ${b.offset},`).join('\n')}
}

/**
 * The masks the contract itself branches on. \`classify()\`, \`takesSwapCut()\`,
 * \`canBlockSwaps()\` and \`canTrapLiquidity()\` are all expressed in these, so a
 * local mirror built from them cannot disagree with the on-chain answer.
 */
export const PERM = {
${Object.entries(PERMS)
  .map(([name, value]) => `  ${name}: ${hex(value)},`)
  .join('\n')}
} as const

/** Callbacks covered by each risk-bearing mask. Derived, never hand-listed. */
export const SWAP_CUT_CALLBACKS = [${maskMembers('PERM_SWAP_CUT_MASK').map(q).join(', ')}] as const
export const RETURNS_DELTA_CALLBACKS = [${maskMembers('PERM_RETURNS_DELTA_MASK').map(q).join(', ')}] as const
export const VETO_CALLBACKS = [${maskMembers('PERM_BEFORE_MASK').map(q).join(', ')}] as const

/** \`enum Verification\` — index is the \`uint8\` that crosses the ABI. */
export const VERIFICATION_LEVELS = [${ENUMS.Verification.map(q).join(', ')}] as const
export type Verification = (typeof VERIFICATION_LEVELS)[number]

/** \`enum Listing\`. */
export const LISTING_STATES = [${ENUMS.Listing.map(q).join(', ')}] as const
export type Listing = (typeof LISTING_STATES)[number]

/** \`enum RiskClass\` — the output of the contract's pure \`classify()\`. */
export const RISK_CLASSES = [${ENUMS.RiskClass.map(q).join(', ')}] as const
export type RiskClass = (typeof RISK_CLASSES)[number]

/**
 * Read-only ABI of LatchHookRegistry: every view and pure the explorer calls, the
 * events it reads (\`HookListingChanged\` carries the tombstone reason string, which
 * exists nowhere in storage), and the custom errors, so a revert decodes to a name.
 * No state-changing function is present — this ABI cannot encode one.
 */
export const REGISTRY_ABI = ${abiLiteral} as const
`

await mkdir(dirname(outFile), { recursive: true })
await writeFile(outFile, source, 'utf8')
console.log(
  `[sync-registry] ${bits.length} permission bits, ${Object.keys(ENUMS).length} enums, ` +
    `${readAbi.length} reads, ${eventAbi.length} events, ${errorAbi.length} errors -> src/data/registry.generated.ts ` +
    `(bitmap cross-checked against the SDK)`,
)
