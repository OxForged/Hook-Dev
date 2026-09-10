// SPDX-License-Identifier: MIT
/**
 * Framework-agnostic embedding.
 *
 * Two escape hatches for hosts that are not React:
 *
 * - **Custom elements** - `<latch-swap-widget>`, `<latch-liquidity-widget>` and
 *   `<latch-launch-widget>`, rendered into a shadow root. Works anywhere a
 *   browser runs, including plain HTML.
 * - **Iframe bridge** - the widget runs in its own realm and asks the host page
 *   to perform every chain read and write over a documented postMessage
 *   contract. For hosts that will not execute third-party script in their realm.
 *
 * Importing this module does not register anything. Call
 * {@link defineLatchWidgets} when you want the elements defined.
 *
 * @packageDocumentation
 */

export {
  defineLatchWidgets,
  WIDGET_TAG_NAMES,
  LatchSwapWidgetElement,
  LatchLiquidityWidgetElement,
  LatchLaunchWidgetElement,
} from "./embed/webComponent.js";

export {
  WIDGET_CHANNEL,
  WIDGET_PROTOCOL_VERSION,
  createIframeBridgeAdapter,
  reportWidgetHeight,
  serveWidgetIframe,
  type BridgeMethod,
  type HostInitMessage,
  type HostMessage,
  type HostResultMessage,
  type IframeBridgeOptions,
  type ServeWidgetIframeOptions,
  type WidgetEventMessage,
  type WidgetInvokeMessage,
  type WidgetMessage,
  type WidgetReadyMessage,
  type WidgetResizeMessage,
} from "./embed/iframe.js";

export { WIDGET_CSS, injectWidgetStyles } from "./styles/css.js";
