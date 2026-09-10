// SPDX-License-Identifier: MIT
/**
 * Iframe embedding: the postMessage contract.
 *
 * The web component is the right answer for most hosts. The iframe exists for
 * the case the web component cannot serve: a host that will not run third-party
 * script in its own realm - which, for a widget asking users to sign
 * transactions, is a reasonable position for a host to take.
 *
 * ## The split
 *
 * The **widget** runs inside the iframe and owns only rendering. It holds no
 * keys and opens no RPC connections. Every chain read and write is a request to
 * the host.
 *
 * The **host** runs in the parent page, owns the wallet and a real
 * {@link ../adapters/protocol.js | ProtocolAdapter}, and answers those requests.
 *
 * ```text
 *  iframe (widget)                         parent (host)
 *  ────────────────                        ─────────────
 *   ready ─────────────────────────────────▶
 *        ◀───────────────────────────── init { chain, integrator, theme }
 *   invoke { id, method, args } ───────────▶
 *        ◀────────── result { id, ok, value } | { id, ok: false, error }
 *   resize { height } ─────────────────────▶
 *   event  { name, payload } ──────────────▶
 * ```
 *
 * ## Message contract
 *
 * Every message is `{ channel: "latch-widget", version: 1, ... }`. Anything
 * without that envelope is ignored. Both sides pin the counterpart origin -
 * the host passes the widget's origin, the widget receives the host's in
 * `init` - and every later message is checked against it. `event.origin` is the
 * only trustworthy field on a `MessageEvent`; nothing inside `data` is trusted
 * for identity.
 *
 * `BigInt` survives structured clone, so amounts cross the boundary as exact
 * integers. Never stringify them for transport - a float round-trip is how
 * money goes missing.
 *
 * ## What the host must validate
 *
 * The host is the security boundary. Before signing anything it should check:
 *
 * - the transaction's `to` is a contract it expects (its own router address);
 * - `value` matches what the user was shown;
 * - `integratorFee.referrer` is the host's own address, if it configured one.
 *
 * A widget in an iframe is still third-party code. This contract makes it
 * *inspectable*, not trusted.
 */

import type {
  ProtocolAdapter,
  WidgetTransactionRequest,
} from "../adapters/protocol.js";
import type { IntegratorConfig } from "../config/integrator.js";
import type { WidgetTheme } from "../context/WidgetProvider.js";

/** Channel name on every message in this protocol. */
export const WIDGET_CHANNEL = "latch-widget";

/** Version of the message contract. Bumped on any breaking change. */
export const WIDGET_PROTOCOL_VERSION = 1;

/** Adapter methods the widget may invoke on the host. */
export type BridgeMethod = Extract<
  keyof ProtocolAdapter,
  | "getAccount"
  | "listTokens"
  | "getToken"
  | "getBalance"
  | "listPools"
  | "getPoolState"
  | "getApprovalRequirements"
  | "buildApproval"
  | "quoteSwap"
  | "buildSwap"
  | "quoteAddLiquidity"
  | "buildAddLiquidity"
  | "listPositions"
  | "quoteRemoveLiquidity"
  | "buildRemoveLiquidity"
  | "listLaunches"
  | "getLaunch"
  | "getLaunchAccountState"
  | "quoteLaunchBuy"
  | "buildLaunchBuy"
  | "sendTransaction"
  | "waitForTransaction"
>;

/** Sent by the widget once it has mounted and is ready for `init`. */
export interface WidgetReadyMessage {
  readonly channel: typeof WIDGET_CHANNEL;
  readonly version: number;
  readonly type: "ready";
}

/** Sent by the host in response to `ready`. */
export interface HostInitMessage {
  readonly channel: typeof WIDGET_CHANNEL;
  readonly version: number;
  readonly type: "init";
  readonly widget: "swap" | "liquidity" | "launch";
  readonly integrator: IntegratorConfig | null;
  readonly theme: WidgetTheme;
  /** Chain metadata, minus anything unserialisable (no transport). */
  readonly chain: {
    readonly chainId: number;
    readonly name: string;
    readonly nativeCurrency: { name: string; symbol: string; decimals: number };
    readonly blockExplorerUrl?: string;
  };
  /** `true` when the host's adapter is a mock, so the widget can warn. */
  readonly isMock: boolean;
}

/** A remote adapter call, widget to host. */
export interface WidgetInvokeMessage {
  readonly channel: typeof WIDGET_CHANNEL;
  readonly version: number;
  readonly type: "invoke";
  readonly id: string;
  readonly method: BridgeMethod;
  readonly args: readonly unknown[];
}

/** The host's answer to an `invoke`. */
export type HostResultMessage =
  | {
      readonly channel: typeof WIDGET_CHANNEL;
      readonly version: number;
      readonly type: "result";
      readonly id: string;
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly channel: typeof WIDGET_CHANNEL;
      readonly version: number;
      readonly type: "result";
      readonly id: string;
      readonly ok: false;
      readonly error: { readonly name: string; readonly message: string };
    };

/** Height report, so the host can size the iframe without scrollbars. */
export interface WidgetResizeMessage {
  readonly channel: typeof WIDGET_CHANNEL;
  readonly version: number;
  readonly type: "resize";
  readonly height: number;
}

/** Lifecycle notifications the host may log or act on. */
export interface WidgetEventMessage {
  readonly channel: typeof WIDGET_CHANNEL;
  readonly version: number;
  readonly type: "event";
  readonly name: "quote" | "transaction-submitted" | "transaction-confirmed" | "error";
  readonly payload: Record<string, unknown>;
}

/** Anything the widget sends. */
export type WidgetMessage =
  | WidgetReadyMessage
  | WidgetInvokeMessage
  | WidgetResizeMessage
  | WidgetEventMessage;

/** Anything the host sends. */
export type HostMessage = HostInitMessage | HostResultMessage;

function isEnvelope(data: unknown): data is { channel: string; version: number; type: string } {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    record["channel"] === WIDGET_CHANNEL &&
    record["version"] === WIDGET_PROTOCOL_VERSION &&
    typeof record["type"] === "string"
  );
}

/** Options for {@link serveWidgetIframe}. */
export interface ServeWidgetIframeOptions {
  /** The iframe element the widget is running in. */
  readonly iframe: HTMLIFrameElement;
  /** Exact origin the iframe is served from. Never `"*"`. */
  readonly widgetOrigin: string;
  /** The adapter that answers the widget's requests. */
  readonly adapter: ProtocolAdapter;
  readonly widget: "swap" | "liquidity" | "launch";
  readonly integrator?: IntegratorConfig;
  readonly theme?: WidgetTheme;
  /**
   * Last-line inspection before a transaction is signed. Return `false` to
   * refuse. Use it to assert the fee recipient is you.
   */
  readonly approveTransaction?: (request: WidgetTransactionRequest) => boolean | Promise<boolean>;
  /** Called on every widget event, for analytics. */
  readonly onEvent?: (message: WidgetEventMessage) => void;
  /** Called when the widget reports its height. */
  readonly onResize?: (height: number) => void;
}

/**
 * Host side of the bridge: answers the widget's adapter calls.
 *
 * @returns a disposer that removes the listener.
 */
export function serveWidgetIframe(options: ServeWidgetIframeOptions): () => void {
  const { iframe, widgetOrigin, adapter } = options;

  if (widgetOrigin === "*" || widgetOrigin.trim() === "") {
    throw new Error(
      '[@latchprotocol/widgets] widgetOrigin must be an exact origin, never "*". ' +
        "A wildcard origin lets any framed page impersonate the widget.",
    );
  }

  const post = (message: HostMessage): void => {
    iframe.contentWindow?.postMessage(message, widgetOrigin);
  };

  const handler = async (event: MessageEvent<unknown>): Promise<void> => {
    if (event.origin !== widgetOrigin) return;
    if (event.source !== iframe.contentWindow) return;
    if (!isEnvelope(event.data)) return;
    const message = event.data as WidgetMessage;

    if (message.type === "ready") {
      post({
        channel: WIDGET_CHANNEL,
        version: WIDGET_PROTOCOL_VERSION,
        type: "init",
        widget: options.widget,
        integrator: options.integrator ?? null,
        theme: options.theme ?? "system",
        chain: {
          chainId: adapter.chain.chainId,
          name: adapter.chain.name,
          nativeCurrency: adapter.chain.nativeCurrency,
          ...(adapter.chain.blockExplorerUrl === undefined
            ? {}
            : { blockExplorerUrl: adapter.chain.blockExplorerUrl }),
        },
        isMock: adapter.isMock,
      });
      return;
    }

    if (message.type === "resize") {
      options.onResize?.(message.height);
      return;
    }

    if (message.type === "event") {
      options.onEvent?.(message);
      return;
    }

    if (message.type !== "invoke") return;

    try {
      if (message.method === "sendTransaction" && options.approveTransaction !== undefined) {
        const request = message.args[0] as WidgetTransactionRequest;
        const approved = await options.approveTransaction(request);
        if (!approved) {
          throw new Error("The host refused this transaction");
        }
      }
      const method = adapter[message.method] as (...args: unknown[]) => Promise<unknown>;
      if (typeof method !== "function") {
        throw new Error(`Unknown bridge method: ${String(message.method)}`);
      }
      const value: unknown = await method.apply(adapter, [...message.args]);
      post({
        channel: WIDGET_CHANNEL,
        version: WIDGET_PROTOCOL_VERSION,
        type: "result",
        id: message.id,
        ok: true,
        value,
      });
    } catch (cause: unknown) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      post({
        channel: WIDGET_CHANNEL,
        version: WIDGET_PROTOCOL_VERSION,
        type: "result",
        id: message.id,
        ok: false,
        error: { name: error.name, message: error.message },
      });
    }
  };

  const listener = (event: MessageEvent<unknown>): void => {
    void handler(event);
  };

  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/** A pending remote call. */
interface PendingCall {
  resolve(value: unknown): void;
  reject(reason: Error): void;
}

/** Options for {@link createIframeBridgeAdapter}. */
export interface IframeBridgeOptions {
  /** Exact origin of the host page. */
  readonly hostOrigin: string;
  /** How long to wait for a reply before failing, in ms. */
  readonly timeoutMs?: number;
}

/**
 * Widget side of the bridge: a {@link ProtocolAdapter} that forwards every call
 * to the host page.
 *
 * Runs inside the iframe. Resolves once the host's `init` arrives, so a widget
 * never renders against a half-configured bridge.
 */
export async function createIframeBridgeAdapter(
  options: IframeBridgeOptions,
): Promise<{ adapter: ProtocolAdapter; init: HostInitMessage; dispose(): void }> {
  const { hostOrigin } = options;
  const timeoutMs = options.timeoutMs ?? 60_000;

  if (hostOrigin === "*" || hostOrigin.trim() === "") {
    throw new Error('[@latchprotocol/widgets] hostOrigin must be an exact origin, never "*"');
  }

  const pending = new Map<string, PendingCall>();
  let counter = 0;
  let init: HostInitMessage | null = null;
  let resolveInit: ((message: HostInitMessage) => void) | null = null;

  const initPromise = new Promise<HostInitMessage>((resolve) => {
    resolveInit = resolve;
  });

  const listener = (event: MessageEvent<unknown>): void => {
    if (event.origin !== hostOrigin) return;
    if (!isEnvelope(event.data)) return;
    const message = event.data as HostMessage;

    if (message.type === "init") {
      init = message;
      resolveInit?.(message);
      return;
    }
    if (message.type !== "result") return;

    const call = pending.get(message.id);
    if (call === undefined) return;
    pending.delete(message.id);
    if (message.ok) call.resolve(message.value);
    else {
      const error = new Error(message.error.message);
      error.name = message.error.name;
      call.reject(error);
    }
  };

  window.addEventListener("message", listener);

  const send = (message: WidgetMessage): void => {
    window.parent.postMessage(message, hostOrigin);
  };

  const invoke = (method: BridgeMethod, args: readonly unknown[]): Promise<unknown> => {
    counter += 1;
    const id = `${Date.now().toString(36)}-${counter}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`[@latchprotocol/widgets] host did not answer ${method} in ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      });
      send({
        channel: WIDGET_CHANNEL,
        version: WIDGET_PROTOCOL_VERSION,
        type: "invoke",
        id,
        method,
        args,
      });
    });
  };

  send({ channel: WIDGET_CHANNEL, version: WIDGET_PROTOCOL_VERSION, type: "ready" });
  const resolved = await initPromise;

  const call =
    (method: BridgeMethod) =>
    (...args: unknown[]): Promise<never> =>
      invoke(method, args) as Promise<never>;

  const adapter: ProtocolAdapter = {
    kind: "iframe-bridge",
    isMock: resolved.isMock,
    chain: {
      chainId: resolved.chain.chainId,
      name: resolved.chain.name,
      nativeCurrency: resolved.chain.nativeCurrency,
      // The bridge deliberately carries no addresses: the widget never builds
      // calldata itself, the host does.
      contracts: { vault: "0x0000000000000000000000000000000000000000" },
      ...(resolved.chain.blockExplorerUrl === undefined
        ? {}
        : { blockExplorerUrl: resolved.chain.blockExplorerUrl }),
    },
    getAccount: call("getAccount"),
    listTokens: call("listTokens"),
    getToken: call("getToken"),
    getBalance: call("getBalance"),
    listPools: call("listPools"),
    getPoolState: call("getPoolState"),
    getApprovalRequirements: call("getApprovalRequirements"),
    buildApproval: call("buildApproval"),
    quoteSwap: call("quoteSwap"),
    buildSwap: call("buildSwap"),
    quoteAddLiquidity: call("quoteAddLiquidity"),
    buildAddLiquidity: call("buildAddLiquidity"),
    listPositions: call("listPositions"),
    quoteRemoveLiquidity: call("quoteRemoveLiquidity"),
    buildRemoveLiquidity: call("buildRemoveLiquidity"),
    listLaunches: call("listLaunches"),
    getLaunch: call("getLaunch"),
    getLaunchAccountState: call("getLaunchAccountState"),
    quoteLaunchBuy: call("quoteLaunchBuy"),
    buildLaunchBuy: call("buildLaunchBuy"),
    sendTransaction: call("sendTransaction"),
    waitForTransaction: call("waitForTransaction"),
  };

  return {
    adapter,
    init: resolved,
    dispose: () => {
      window.removeEventListener("message", listener);
      pending.clear();
      init = null;
      void init;
    },
  };
}

/** Reports the widget's height to the host, so the iframe can be sized to it. */
export function reportWidgetHeight(hostOrigin: string, element: HTMLElement): () => void {
  const send = (): void => {
    const message: WidgetResizeMessage = {
      channel: WIDGET_CHANNEL,
      version: WIDGET_PROTOCOL_VERSION,
      type: "resize",
      height: Math.ceil(element.getBoundingClientRect().height),
    };
    window.parent.postMessage(message, hostOrigin);
  };
  send();
  if (typeof ResizeObserver === "undefined") return () => undefined;
  const observer = new ResizeObserver(send);
  observer.observe(element);
  return () => observer.disconnect();
}
