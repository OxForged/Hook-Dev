// SPDX-License-Identifier: MIT
/**
 * The one piece of shared state every widget reads.
 *
 * `WidgetProvider` holds the adapter, the chain config and - critically - the
 * *validated* integrator config. Validation happens once, here, at mount:
 * a bad `feeBps` or a missing `referrer` fails immediately and visibly rather
 * than at the moment a user presses Swap.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { ProtocolAdapter } from "../adapters/protocol.js";
import type { ChainConfig } from "../config/chain.js";
import { assertValidChainConfig } from "../config/chain.js";
import {
  resolveIntegratorConfig,
  type IntegratorConfig,
  type ResolvedIntegratorConfig,
} from "../config/integrator.js";
import { DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS } from "../core/math.js";

/** Colour scheme applied to the styled widgets. */
export type WidgetTheme = "light" | "dark" | "system";

/** Value exposed to every widget beneath the provider. */
export interface WidgetContextValue {
  readonly adapter: ProtocolAdapter;
  readonly chain: ChainConfig;
  /** Always validated. Never optional at this layer. */
  readonly integrator: ResolvedIntegratorConfig;
  readonly defaultSlippageBps: number;
  readonly theme: WidgetTheme;
  /** Locale used by number formatting; defaults to the browser's. */
  readonly locale: string | undefined;
}

const WidgetContext = createContext<WidgetContextValue | null>(null);

/** Props accepted by {@link WidgetProvider}. */
export interface WidgetProviderProps {
  /** Where chain reads and writes go. Mock in dev, viem-backed in production. */
  readonly adapter: ProtocolAdapter;
  /**
   * Integrator fee attribution.
   *
   * Omit it and the widgets work, earning you nothing. Supplying it is the
   * entire commercial reason to embed them.
   */
  readonly integrator?: IntegratorConfig;
  readonly defaultSlippageBps?: number;
  readonly theme?: WidgetTheme;
  readonly locale?: string;
  readonly children: ReactNode;
}

/** Root provider. Wrap every widget in exactly one of these. */
export function WidgetProvider(props: WidgetProviderProps): JSX.Element {
  const {
    adapter,
    integrator,
    defaultSlippageBps = DEFAULT_SLIPPAGE_BPS,
    theme = "system",
    locale,
    children,
  } = props;

  // Throws synchronously during render on a bad config. That is intended: a
  // widget that silently drops the integrator's fee is worse than one that
  // refuses to mount and says why.
  const resolvedIntegrator = useMemo(
    () => resolveIntegratorConfig(integrator ?? null),
    [integrator],
  );

  const chain = adapter.chain;

  useMemo(() => {
    assertValidChainConfig(chain);
    return null;
  }, [chain]);

  if (!Number.isInteger(defaultSlippageBps) || defaultSlippageBps < 0) {
    throw new RangeError(
      `[@latchprotocol/widgets] defaultSlippageBps must be a non-negative integer: ${defaultSlippageBps}`,
    );
  }
  if (defaultSlippageBps > MAX_SLIPPAGE_BPS) {
    throw new RangeError(
      `[@latchprotocol/widgets] defaultSlippageBps ${defaultSlippageBps} exceeds ` +
        `MAX_SLIPPAGE_BPS (${MAX_SLIPPAGE_BPS})`,
    );
  }

  useEffect(() => {
    for (const warning of resolvedIntegrator.warnings) {
      // eslint-disable-next-line no-console
      console.warn(`[@latchprotocol/widgets] ${warning}`);
    }
  }, [resolvedIntegrator]);

  const value = useMemo<WidgetContextValue>(
    () => ({
      adapter,
      chain,
      integrator: resolvedIntegrator,
      defaultSlippageBps,
      theme,
      locale,
    }),
    [adapter, chain, resolvedIntegrator, defaultSlippageBps, theme, locale],
  );

  return <WidgetContext.Provider value={value}>{children}</WidgetContext.Provider>;
}

/** Reads the widget context. Throws when used outside a {@link WidgetProvider}. */
export function useWidgetContext(): WidgetContextValue {
  const value = useContext(WidgetContext);
  if (value === null) {
    throw new Error(
      "[@latchprotocol/widgets] no WidgetProvider found. Wrap your app (or just the " +
        "widget) in <WidgetProvider adapter={...} integrator={...}>.",
    );
  }
  return value;
}

/** Convenience accessor for the adapter. */
export function useProtocolAdapter(): ProtocolAdapter {
  return useWidgetContext().adapter;
}

/** Convenience accessor for the validated integrator config. */
export function useIntegrator(): ResolvedIntegratorConfig {
  return useWidgetContext().integrator;
}
