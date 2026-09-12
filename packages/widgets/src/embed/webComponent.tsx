// SPDX-License-Identifier: MIT
/**
 * Custom-element wrappers, for hosts that are not React.
 *
 * Vue, Svelte, Angular, Astro and plain HTML can all render a custom element.
 * These mount the same React components into a shadow root, so the widget's CSS
 * cannot leak into the host page and the host's CSS cannot break the widget -
 * while `--latch-*` custom properties still inherit through the shadow boundary,
 * which is exactly the theming behaviour an embedder wants.
 *
 * ```html
 * <script type="module" src="/latch-widgets.js"></script>
 * <latch-swap-widget
 *   adapter="mock"
 *   theme="dark"
 *   integrator='{"referrer":"0x1111111111111111111111111111111111111111","feeBps":25}'
 *   chain='{"chainId":8453,"name":"Base","nativeCurrency":{"name":"Ether","symbol":"ETH","decimals":18},"contracts":{"vault":"0x...","clPoolManager":"0x..."}}'
 * ></latch-swap-widget>
 * ```
 *
 * For a live deployment the adapter cannot come from an attribute - a viem
 * transport is not JSON - so set it as a property instead:
 *
 * ```js
 * document.querySelector("latch-swap-widget").adapter = createViemAdapter({...});
 * ```
 */

import { createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProtocolAdapter } from "../adapters/protocol.js";
import { createMockAdapter } from "../adapters/mock.js";
import type { ChainConfig } from "../config/chain.js";
import type { IntegratorConfig } from "../config/integrator.js";
import { WidgetProvider, type WidgetTheme } from "../context/WidgetProvider.js";
import { LaunchWidget } from "../components/LaunchWidget.js";
import { LiquidityWidget } from "../components/LiquidityWidget.js";
import { SwapWidget } from "../components/SwapWidget.js";
import { WIDGET_CSS } from "../styles/css.js";

/** Attributes every Latch widget element understands. */
const COMMON_ATTRIBUTES = [
  "adapter",
  "chain",
  "integrator",
  "theme",
  "slippage-bps",
  "title-text",
] as const;

function parseJsonAttribute<T>(value: string | null, label: string): T | null {
  if (value === null || value.trim() === "") return null;
  try {
    return JSON.parse(value) as T;
  } catch (cause: unknown) {
    throw new Error(
      `[@latchprotocol/widgets] the ${label} attribute is not valid JSON: ${String(cause)}`,
    );
  }
}

/**
 * SSR-safe `HTMLElement`.
 *
 * `class X extends HTMLElement` is evaluated at module load, so importing this
 * file in Node - which any host doing server-side rendering does - would throw
 * `HTMLElement is not defined` before a single line of user code ran. On the
 * server the classes extend an inert stand-in instead. They are never
 * instantiated there: `defineLatchWidgets` no-ops without `customElements`, and
 * only the browser's custom-element machinery constructs them.
 */
const ElementBase: typeof HTMLElement =
  typeof HTMLElement === "undefined"
    ? (class {} as unknown as typeof HTMLElement)
    : HTMLElement;

/** Base class shared by every widget element. */
abstract class LatchWidgetElement extends ElementBase {
  #root: Root | null = null;
  #shadow: ShadowRoot | null = null;
  #adapter: ProtocolAdapter | null = null;
  #error: string | null = null;

  /** Observed attributes, extended by each subclass. */
  static get observedAttributes(): readonly string[] {
    return COMMON_ATTRIBUTES;
  }

  /** The adapter, when set imperatively. Takes precedence over the attribute. */
  get adapter(): ProtocolAdapter | null {
    return this.#adapter;
  }

  set adapter(value: ProtocolAdapter | null) {
    this.#adapter = value;
    this.#render();
  }

  connectedCallback(): void {
    if (this.#shadow === null) {
      this.#shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = WIDGET_CSS;
      this.#shadow.appendChild(style);
      const mount = document.createElement("div");
      this.#shadow.appendChild(mount);
      this.#root = createRoot(mount);
    }
    this.#render();
  }

  disconnectedCallback(): void {
    const root = this.#root;
    this.#root = null;
    // Unmount asynchronously: React refuses to unmount during a commit, and a
    // custom element can be disconnected from inside one.
    if (root !== null) queueMicrotask(() => root.unmount());
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  /** The React component this element renders. */
  protected abstract component(): ComponentType<Record<string, unknown>>;

  /** Extra props derived from element attributes. */
  protected widgetProps(): Record<string, unknown> {
    const title = this.getAttribute("title-text");
    return title === null ? {} : { title };
  }

  #resolveAdapter(): ProtocolAdapter | null {
    if (this.#adapter !== null) return this.#adapter;
    const requested = this.getAttribute("adapter");
    if (requested === "mock") {
      const chain = parseJsonAttribute<ChainConfig>(this.getAttribute("chain"), "chain");
      if (chain === null) {
        throw new Error(
          '[@latchprotocol/widgets] adapter="mock" also needs a `chain` attribute ' +
            "containing the chain config as JSON.",
        );
      }
      const account = this.getAttribute("account");
      return createMockAdapter({
        chain,
        account: account === null ? null : (account as `0x${string}`),
      });
    }
    return null;
  }

  #render(): void {
    if (this.#root === null) return;
    try {
      const adapter = this.#resolveAdapter();
      if (adapter === null) {
        this.#root.render(
          createElement(
            "div",
            { className: "latch-widget" },
            createElement(
              "p",
              { className: "latch-error", role: "alert" },
              'No adapter. Set the element\'s `adapter` property, or use adapter="mock" ' +
                "with a `chain` attribute for development.",
            ),
          ),
        );
        return;
      }

      const integrator = parseJsonAttribute<IntegratorConfig>(
        this.getAttribute("integrator"),
        "integrator",
      );
      const theme = (this.getAttribute("theme") ?? "system") as WidgetTheme;
      const slippageRaw = this.getAttribute("slippage-bps");

      this.#error = null;
      this.#root.render(
        createElement(WidgetProvider, {
          adapter,
          theme,
          ...(integrator === null ? {} : { integrator }),
          ...(slippageRaw === null ? {} : { defaultSlippageBps: Number(slippageRaw) }),
          children: createElement(this.component(), this.widgetProps()),
        }),
      );
    } catch (cause: unknown) {
      this.#error = cause instanceof Error ? cause.message : String(cause);
      this.#root.render(
        createElement(
          "div",
          { className: "latch-widget" },
          createElement("p", { className: "latch-error", role: "alert" }, this.#error),
        ),
      );
    }
  }
}

/** `<latch-swap-widget>`. */
export class LatchSwapWidgetElement extends LatchWidgetElement {
  static override get observedAttributes(): readonly string[] {
    return [...COMMON_ATTRIBUTES, "token-in", "token-out", "account"];
  }

  protected override component(): ComponentType<Record<string, unknown>> {
    return SwapWidget as ComponentType<Record<string, unknown>>;
  }

  protected override widgetProps(): Record<string, unknown> {
    const tokenIn = this.getAttribute("token-in");
    const tokenOut = this.getAttribute("token-out");
    return {
      ...super.widgetProps(),
      ...(tokenIn === null ? {} : { defaultTokenIn: tokenIn }),
      ...(tokenOut === null ? {} : { defaultTokenOut: tokenOut }),
    };
  }
}

/** `<latch-liquidity-widget>`. */
export class LatchLiquidityWidgetElement extends LatchWidgetElement {
  static override get observedAttributes(): readonly string[] {
    return [...COMMON_ATTRIBUTES, "pool-id", "mode", "account"];
  }

  protected override component(): ComponentType<Record<string, unknown>> {
    return LiquidityWidget as ComponentType<Record<string, unknown>>;
  }

  protected override widgetProps(): Record<string, unknown> {
    const poolId = this.getAttribute("pool-id");
    const mode = this.getAttribute("mode");
    return {
      ...super.widgetProps(),
      ...(poolId === null ? {} : { defaultPoolId: poolId }),
      ...(mode === "remove" || mode === "add" ? { defaultMode: mode } : {}),
    };
  }
}

/** `<latch-launch-widget>`. */
export class LatchLaunchWidgetElement extends LatchWidgetElement {
  static override get observedAttributes(): readonly string[] {
    return [...COMMON_ATTRIBUTES, "pool-id", "account"];
  }

  protected override component(): ComponentType<Record<string, unknown>> {
    return LaunchWidget as ComponentType<Record<string, unknown>>;
  }

  protected override widgetProps(): Record<string, unknown> {
    // A pool id, not a launchpad address: LaunchGuardHook keys every launch
    // by PoolId, and there is no per-launch contract to point at.
    const poolId = this.getAttribute("pool-id");
    return {
      ...super.widgetProps(),
      ...(poolId === null ? {} : { poolId }),
    };
  }
}

/** Element tag names, so hosts do not have to hardcode strings. */
export const WIDGET_TAG_NAMES = {
  swap: "latch-swap-widget",
  liquidity: "latch-liquidity-widget",
  launch: "latch-launch-widget",
} as const;

/**
 * Registers every widget element.
 *
 * Safe to call more than once; already-registered tags are skipped rather than
 * throwing, so two copies of the bundle on one page do not break it.
 */
export function defineLatchWidgets(): void {
  if (typeof customElements === "undefined") return;
  const registry: readonly [string, CustomElementConstructor][] = [
    [WIDGET_TAG_NAMES.swap, LatchSwapWidgetElement],
    [WIDGET_TAG_NAMES.liquidity, LatchLiquidityWidgetElement],
    [WIDGET_TAG_NAMES.launch, LatchLaunchWidgetElement],
  ];
  for (const [tag, constructor] of registry) {
    if (customElements.get(tag) === undefined) {
      customElements.define(tag, constructor);
    }
  }
}
