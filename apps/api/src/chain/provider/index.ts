import { env, rpcUrlForChain } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { ChainProviderNotConfiguredError } from "../../lib/errors.js";
import type { ContractRef } from "../contracts.js";
import { FixtureChainLogProvider } from "./fixture.js";
import { RpcChainLogProvider } from "./rpc.js";
import type { ChainLogProvider } from "./types.js";

export * from "./types.js";
export { FixtureChainLogProvider } from "./fixture.js";
export { RpcChainLogProvider } from "./rpc.js";

const providers = new Map<string, ChainLogProvider>();

/**
 * Choose a chain-data provider for a chain.
 *
 * The selection rule is the whole of the mock/live policy:
 *
 *   CHAIN_PROVIDER=fixture  always fixtures (the default; nothing is deployed)
 *   CHAIN_PROVIDER=rpc      always RPC, and throw loudly if it cannot be built
 *   CHAIN_PROVIDER=auto     RPC when the chain has both an endpoint and known
 *                           contract addresses; fixtures otherwise
 *
 * `auto` is the setting to use once some chains are live and others are not.
 */
export function getChainLogProvider(
  chainId: number,
  contracts: readonly ContractRef[],
): ChainLogProvider {
  const cacheKey = `${chainId}:${env.CHAIN_PROVIDER}:${contracts.length}`;
  const existing = providers.get(cacheKey);
  if (existing) return existing;

  const provider = build(chainId, contracts);
  providers.set(cacheKey, provider);
  logger.info({ chainId, provider: provider.describe() }, "chain-data provider selected");
  return provider;
}

function build(chainId: number, contracts: readonly ContractRef[]): ChainLogProvider {
  const rpcUrl = rpcUrlForChain(chainId);

  switch (env.CHAIN_PROVIDER) {
    case "fixture":
      return new FixtureChainLogProvider(chainId);

    case "rpc": {
      if (!rpcUrl) throw new ChainProviderNotConfiguredError(chainId, `RPC_URL_${chainId} is not set`);
      if (contracts.length === 0) {
        throw new ChainProviderNotConfiguredError(
          chainId,
          "no Vault or pool manager addresses are recorded for this chain",
        );
      }
      return new RpcChainLogProvider(chainId, rpcUrl);
    }

    case "auto": {
      if (rpcUrl && contracts.length > 0) return new RpcChainLogProvider(chainId, rpcUrl);
      logger.info(
        {
          chainId,
          hasRpcUrl: Boolean(rpcUrl),
          contractCount: contracts.length,
        },
        "auto mode falling back to fixtures: chain is not fully configured",
      );
      return new FixtureChainLogProvider(chainId);
    }
  }
}

/** Drop cached providers. Used by tests and after a config change. */
export function resetChainLogProviders(): void {
  providers.clear();
}
