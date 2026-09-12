// SPDX-License-Identifier: MIT
/**
 * Providers, routing and the config gate.
 *
 * The config gate comes first and blocks everything: if `latch.config.ts` has
 * an error in it, the app renders the error with the field name rather than
 * mounting a UI that will fail one read at a time. A tenant editing one file
 * should find out immediately, in the page, what they broke.
 */

import { LatchWalletProvider, createLatchConfig, latchChainById } from "@latchprotocol/connect";
import { WidgetProvider, createViemAdapter } from "@latchprotocol/widgets";
import type { ProtocolAdapter, ChainConfig } from "@latchprotocol/widgets";
import { useMemo, type ReactElement } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import type { Chain } from "viem";
import { useAccount, useWalletClient } from "wagmi";

import { Shell } from "./components/Shell";
import { Async, Empty, ErrorState } from "./components/States";
import { hasBlockingProblem, resolveConfig } from "./config/resolve";
import { activeChain, publicClient } from "./lib/client";
import { readPools, toWidgetPools } from "./lib/pools";
import { readTokens } from "./lib/tokens";
import { useAsync } from "./lib/useAsync";
import { Fees } from "./routes/Fees";
import { LaunchWizard } from "./routes/LaunchWizard";
import { Launches } from "./routes/Launches";
import { Pools } from "./routes/Pools";
import { Swap } from "./routes/Swap";

/** Renders `latch.config.ts` problems instead of a broken app. */
function ConfigErrors(): ReactElement {
  const cfg = resolveConfig();
  return (
    <div className="config-gate">
      <h1>latch.config.ts needs fixing</h1>
      <p>
        The app did not mount because the configuration it depends on is not valid. Nothing below
        was read from chain.
      </p>
      <ul className="problem-list">
        {cfg.problems
          .filter((p) => p.severity === "error")
          .map((p) => (
            <li key={`${p.field}:${p.message}`}>
              <code>{p.field}</code>
              <span>{p.message}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * Builds the widgets' adapter from what is actually on chain.
 *
 * Pools come from the CL manager's `Initialize` logs and tokens from the config
 * list read back off their own contracts. There is no on-chain enumeration of
 * either, and neither is invented: an empty pool list produces a swap widget
 * that says there is nothing to route through.
 */
function WidgetLayer({ children }: { children: ReactElement }): ReactElement {
  const cfg = resolveConfig();
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();

  const resource = useAsync(async () => {
    const [tokenResult, poolScan] = await Promise.all([readTokens(), readPools()]);
    return { tokenResult, poolScan };
  }, []);

  const chainConfig: ChainConfig = useMemo(
    () => ({
      chainId: cfg.core.chainId,
      name: cfg.core.name,
      nativeCurrency: cfg.nativeCurrency,
      blockExplorerUrl: cfg.core.explorer,
      contracts: {
        vault: cfg.contracts.vault,
        clPoolManager: cfg.contracts.clPoolManager,
        binPoolManager: cfg.contracts.binPoolManager,
        universalRouter: cfg.contracts.universalRouter,
        clPositionManager: cfg.contracts.clPositionManager,
        binPositionManager: cfg.contracts.binPositionManager,
        permit2: cfg.contracts.permit2,
        quoter: cfg.contracts.clQuoter,
        /* `launchGuardHook`, not `launchpad`, and not the kit. The old line
           passed LaunchpadKit as `contracts.launchpad`, which the widget then
           called a token-sale ABI against — the kit implements no such thing.
           The widget now binds to LaunchGuardHook, which is the contract that
           actually holds a launch's schedule. */
        ...(cfg.launchGuardHook === null ? {} : { launchGuardHook: cfg.launchGuardHook }),
      },
    }),
    [cfg],
  );

  return (
    <Async
      state={resource.state}
      onRetry={resource.reload}
      loadingLabel="Reading pools and tokens"
    >
      {({ tokenResult, poolScan }) => {
        const adapter: ProtocolAdapter = createViemAdapter({
          chain: chainConfig,
          publicClient: publicClient(),
          tokens: tokenResult.tokens,
          pools: toWidgetPools(poolScan.pools),
          ...(walletClient === undefined || address === undefined
            ? {}
            : {
                wallet: {
                  getAccount: async () => address,
                  sendTransaction: async (request) =>
                    walletClient.sendTransaction({
                      to: request.to,
                      data: request.data,
                      value: request.value,
                    }),
                },
              }),
        });

        return (
          <WidgetProvider
            adapter={adapter}
            theme="dark"
            {...(cfg.fee.active
              ? {
                  integrator: {
                    referrer: cfg.fee.wallet,
                    feeBps: cfg.fee.bps,
                    feeMode: cfg.fee.mode,
                    label: cfg.brand.name,
                  },
                }
              : {})}
          >
            {children}
          </WidgetProvider>
        );
      }}
    </Async>
  );
}

function AppRoutes(): ReactElement {
  const cfg = resolveConfig();
  const home = cfg.features.swap ? "/swap" : cfg.features.pools ? "/pools" : "/launch";

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      {cfg.features.swap ? <Route path="/swap" element={<Swap />} /> : null}
      {cfg.features.pools ? <Route path="/pools" element={<Pools />} /> : null}
      {cfg.features.launchpad ? <Route path="/launch" element={<Launches />} /> : null}
      {cfg.features.launchpad ? <Route path="/launch/new" element={<LaunchWizard />} /> : null}
      <Route path="/fees" element={<Fees />} />
      <Route
        path="*"
        element={
          <Empty
            title="No such page"
            detail="That route is not part of this app, or the feature is switched off in latch.config.ts."
          />
        }
      />
    </Routes>
  );
}

export function App(): ReactElement {
  const cfg = resolveConfig();

  if (hasBlockingProblem(cfg)) return <ConfigErrors />;

  const chain: Chain = latchChainById(cfg.core.chainId) ?? activeChain();

  let wagmiConfig;
  try {
    wagmiConfig = createLatchConfig({
      chains: [chain],
      appName: cfg.brand.name,
      ...(cfg.brand.logoUrl === undefined ? {} : { appIcon: cfg.brand.logoUrl }),
    });
  } catch (err) {
    return (
      <ErrorState
        error={err instanceof Error ? err : new Error(String(err))}
      />
    );
  }

  return (
    <LatchWalletProvider config={wagmiConfig} appName={cfg.brand.name} initialChain={chain}>
      <BrowserRouter>
        <Shell>
          <WidgetLayer>
            <AppRoutes />
          </WidgetLayer>
        </Shell>
      </BrowserRouter>
    </LatchWalletProvider>
  );
}
