// SPDX-License-Identifier: MIT
/**
 * Latch Protocol widgets.
 *
 * Embeddable swap, liquidity and launch UI for Latch Protocol, in two layers:
 *
 * - **Headless** (`@latchprotocol/widgets/headless`) - hooks and pure functions
 *   with no markup and no styles. Build your own UI on them.
 * - **Styled** (this entry) - drop-in components on top of the headless layer,
 *   themed entirely through `--latch-*` CSS custom properties.
 *
 * Both share one thing that is not optional: `integrator: { referrer, feeBps }`
 * is validated once at the provider and threaded into the swap call path, so the
 * site embedding the widget earns from the flow it sends.
 *
 * @packageDocumentation
 */

// --- configuration ---------------------------------------------------------
export * from "./config/integrator.js";
export * from "./config/chain.js";

// --- headless core ---------------------------------------------------------
export * from "./core/math.js";
export * from "./core/format.js";

// --- chain boundary --------------------------------------------------------
export * from "./adapters/protocol.js";
export * from "./adapters/sale.js";
export { createMockAdapter, type MockAdapterOptions } from "./adapters/mock.js";
export {
  createViemAdapter,
  type ViemAdapterOptions,
  type ViemAdapterOverrides,
  type WidgetWallet,
} from "./adapters/viem.js";

// --- call path -------------------------------------------------------------
export * from "./callpath/constants.js";
export * from "./callpath/plan.js";
export * from "./callpath/swap.js";
export * from "./callpath/liquidity.js";
export * from "./callpath/launch.js";

// --- react: provider and hooks --------------------------------------------
export * from "./context/WidgetProvider.js";
export * from "./hooks/useAsyncResource.js";
export * from "./hooks/useSwapQuote.js";
export * from "./hooks/useSwapExecute.js";
export * from "./hooks/useLiquidity.js";
export * from "./hooks/useLaunch.js";
export * from "./hooks/useTokens.js";

// --- react: styled components ---------------------------------------------
export * from "./components/primitives.js";
export * from "./components/SwapWidget.js";
export * from "./components/LiquidityWidget.js";
export * from "./components/LaunchWidget.js";

// --- theming ---------------------------------------------------------------
export { WIDGET_CSS, injectWidgetStyles } from "./styles/css.js";
