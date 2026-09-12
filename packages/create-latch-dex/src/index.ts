// SPDX-License-Identifier: MIT
/**
 * create-latch-dex — scaffold a DEX and launchpad front end on LatchProtocol's
 * shared core.
 *
 * ## What this produces, and what it deliberately does not
 *
 * The generated project contains a front end, one config file, and a script
 * that verifies the addresses that config names. It contains **no core
 * contracts**. The tenant does not deploy `Vault`, `CLPoolManager` or
 * `BinPoolManager`; their pools live in the ones Latch already has deployed and
 * verified on the chosen chain.
 *
 * That is the cheaper road for the tenant — no nineteen-contract deployment, no
 * verification, no audit question — and it is the only model in which Latch's
 * protocol fee is enforceable, because `protocolFeeController` on a shared pool
 * manager is set by Latch governance and capped at 0.4% by core.
 *
 * A full fork is possible and the GPL permits it. It is the harder road, it
 * owes nothing, and it gets no shared registry. See the generated README.
 *
 * ## Licensing
 *
 * This package and everything it emits are MIT. That holds only because the
 * emitted app's dependency on the protocol runs through the MIT
 * `@latchprotocol/sdk` and ABIs rather than through GPL Solidity: an ABI call
 * is not linking, so the front end is not a derivative work of the contracts.
 * Import GPL Solidity, or code generated from it, into the template and that
 * analysis stops holding.
 *
 * @packageDocumentation
 */

export { runCreate } from "./commands/create.js";
export { scaffold, templateRoot, ScaffoldError } from "./scaffold.js";
export type { ScaffoldResult } from "./scaffold.js";
export {
  resolveOptions,
  normalizeChain,
  normalizeFeatures,
  toAppName,
  toPackageName,
  looksLikeAddress,
  ALL_FEATURES,
  MAX_FEE_BPS,
  SUPPORTED_CHAINS,
  ZERO_ADDRESS,
} from "./options.js";
export type { ScaffoldOptions, FeatureFlag, ResolveInput } from "./options.js";
export { applyTokens, tokensFor, findUnresolvedTokens, SUBSTITUTED_FILES } from "./template.js";
export type { TokenMap } from "./template.js";
export { CLI_VERSION } from "./version.js";
