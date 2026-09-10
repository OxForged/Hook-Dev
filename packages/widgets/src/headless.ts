// SPDX-License-Identifier: MIT
/**
 * Headless entry point: logic without markup.
 *
 * Import from here when you are building your own UI. It carries the config
 * validation, the quote math, the chain adapters, the call-path encoders and
 * the React controllers - and no components, no stylesheet, and no
 * `react-dom/client`.
 *
 * ```ts
 * import {
 *   WidgetProvider,
 *   useSwapQuote,
 *   useSwapExecute,
 *   validateIntegratorConfig,
 * } from "@latchprotocol/widgets/headless";
 * ```
 *
 * The one thing you do not get to skip by going headless is fee validation:
 * `WidgetProvider` validates the integrator config, and the call-path builders
 * refuse a `ResolvedIntegratorConfig` that did not come from it.
 *
 * @packageDocumentation
 */

export * from "./config/integrator.js";
export * from "./config/chain.js";

export * from "./core/math.js";
export * from "./core/format.js";

export * from "./adapters/protocol.js";
export { createMockAdapter, type MockAdapterOptions } from "./adapters/mock.js";
export {
  createViemAdapter,
  type ViemAdapterOptions,
  type ViemAdapterOverrides,
  type WidgetWallet,
} from "./adapters/viem.js";

export * from "./callpath/constants.js";
export * from "./callpath/plan.js";
export * from "./callpath/swap.js";
export * from "./callpath/liquidity.js";
export * from "./callpath/launch.js";

export * from "./context/WidgetProvider.js";
export * from "./hooks/useAsyncResource.js";
export * from "./hooks/useSwapQuote.js";
export * from "./hooks/useSwapExecute.js";
export * from "./hooks/useLiquidity.js";
export * from "./hooks/useLaunch.js";
export * from "./hooks/useTokens.js";
