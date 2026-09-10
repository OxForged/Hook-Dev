/**
 * Derives the web app's chain list from the SDK, so the two can never drift.
 *
 * `packages/sdk/src/chains/endpoints.ts` is the single source of truth: every chain
 * in it was PROBED with a live TSTORE call, not copied from a docs page. Rather than
 * retyping that list into the UI (where it would rot the first time a chain is added
 * or dropped), this script imports the SDK module and emits
 * `src/data/chains.generated.ts`.
 *
 * The web app is not part of an npm workspace with the SDK, so there is no
 * `@latchprotocol/sdk` to import at runtime. Node 24 strips types on import, so we
 * read the SDK's TypeScript source directly — it is `erasableSyntaxOnly`-clean.
 * (`chains/transport.ts` is NOT: it uses a constructor parameter property, which
 * strip-only mode rejects, and it pulls in viem. So the redundancy figures below are
 * recomputed here from the same two exports `redundancyReport()` uses —
 * `resolveEndpoints()` and `SINGLE_ENDPOINT_CHAINS` — rather than imported.)
 *
 * Run by `predev` / `prebuild`; also `npm run sync-chains`.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const sdkChains = resolve(here, '../../../packages/sdk/src/chains/endpoints.ts')
const outFile = resolve(here, '../src/data/chains.generated.ts')

if (!existsSync(sdkChains)) {
  console.error(`[sync-chains] source of truth not found: ${sdkChains}`)
  console.error('[sync-chains] the chain list is derived from the SDK; restore it before building.')
  process.exit(1)
}

const { CHAIN_RPCS, SINGLE_ENDPOINT_CHAINS, resolveEndpoints } = await import(
  pathToFileURL(sdkChains).href
)

/**
 * Mainnet vs testnet is not a field in the SDK, so it is derived from the chain's
 * own name rather than kept as a second hand-maintained list. Every testnet the SDK
 * carries names itself: "Monad Testnet", "Stable Testnet", "Arc Testnet",
 * "Ethereum Sepolia".
 */
const isTestnet = (name) => /\btestnet\b|\bsepolia\b/i.test(name)

const entries = Object.entries(CHAIN_RPCS).map(([key, cfg]) => {
  // Mirrors `redundancyReport()` in packages/sdk/src/chains/transport.ts.
  const endpointCount = resolveEndpoints(cfg.chainId).length
  return {
    key,
    chainId: cfg.chainId,
    name: cfg.name,
    network: isTestnet(cfg.name) ? 'testnet' : 'mainnet',
    supportsEip1153: cfg.supportsEip1153,
    endpointCount,
    singlePointOfFailure: endpointCount < 2 && SINGLE_ENDPOINT_CHAINS.includes(key),
    fastestEndpoint: cfg.endpoints[0]?.url ?? '',
  }
})

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const body = entries
  .map(
    (c) => `  {
    key: ${q(c.key)},
    chainId: ${c.chainId},
    name: ${q(c.name)},
    network: ${q(c.network)},
    supportsEip1153: ${c.supportsEip1153},
    endpointCount: ${c.endpointCount},
    singlePointOfFailure: ${c.singlePointOfFailure},
    fastestEndpoint: ${q(c.fastestEndpoint)},
  },`,
  )
  .join('\n')

const source = `/* eslint-disable */
/* ============================================================================
   GENERATED FILE — DO NOT EDIT BY HAND.

   Emitted by apps/web/scripts/sync-chains.mjs from
   packages/sdk/src/chains/endpoints.ts (\`CHAIN_RPCS\`), the canonical list of
   Latch Protocol target chains. Every chain below was verified empirically by
   executing a TSTORE probe against the live network — not read from a spec.

   Regenerate with \`npm run sync-chains\`; \`predev\` and \`prebuild\` do it for you.

   NOTE: presence here means "EIP-1153 verified target", NOT "Latch is live".
   Deployment status lives in src/data/chains.ts, which is hand-maintained
   against on-chain reality.
   ============================================================================ */

export type ChainNetwork = 'mainnet' | 'testnet'

export interface SdkChain {
  /** Key in the SDK's \`CHAIN_RPCS\` map. */
  readonly key: ChainKey
  readonly chainId: number
  readonly name: string
  /** Derived from the chain's own name in the SDK. */
  readonly network: ChainNetwork
  /** Decided across endpoints by live probe, not per endpoint. */
  readonly supportsEip1153: boolean
  /** Verified public RPCs known to the SDK. */
  readonly endpointCount: number
  /** Only one endpoint — a fallback transport cannot fail over. */
  readonly singlePointOfFailure: boolean
  readonly fastestEndpoint: string
}

export const CHAIN_KEYS = [
${entries.map((c) => `  ${q(c.key)},`).join('\n')}
] as const

export type ChainKey = (typeof CHAIN_KEYS)[number]

export const SDK_CHAINS: readonly SdkChain[] = [
${body}
]
`

await mkdir(dirname(outFile), { recursive: true })
await writeFile(outFile, source, 'utf8')
console.log(
  `[sync-chains] ${entries.length} chains -> src/data/chains.generated.ts ` +
    `(${entries.filter((c) => c.network === 'mainnet').length} mainnet, ` +
    `${entries.filter((c) => c.network === 'testnet').length} testnet)`,
)
