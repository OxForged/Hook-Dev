// SPDX-License-Identifier: MIT
/**
 * Chain and deployment configuration.
 *
 * LatchProtocol targets many chains, and nothing in this package knows which one
 * you are on. There are no bundled RPC URLs and no address book: every address
 * and every transport arrives from the embedder through a {@link ChainConfig}.
 * That is deliberate - a hardcoded address is a bug that ships to every host.
 */

import { getAddress, isAddress, type Address, type Transport } from "viem";

/** Native asset metadata for a chain. */
export interface NativeCurrencyConfig {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
}

/**
 * Deployed contract addresses.
 *
 * Only `vault` and at least one pool manager are structurally required. The
 * rest are required by the operations that use them, and the widgets fail with
 * a named error rather than a decoding failure when one is missing.
 */
export interface ContractAddresses {
  /** The singleton that custodies every token in the protocol. */
  readonly vault: Address;
  /** Concentrated-liquidity pool manager. */
  readonly clPoolManager?: Address;
  /** Liquidity-book (bin) pool manager. */
  readonly binPoolManager?: Address;
  /** Universal router - the entry point for swaps and integrator fees. */
  readonly universalRouter?: Address;
  /** Position manager for concentrated-liquidity positions. */
  readonly clPositionManager?: Address;
  /** Position manager for liquidity-book positions. */
  readonly binPositionManager?: Address;
  /** Permit2, used by the router to pull the input currency. */
  readonly permit2?: Address;
  /** Off-path quoter, if one is deployed. */
  readonly quoter?: Address;
  /** Launchpad contract backing the launch widget. */
  readonly launchpad?: Address;
}

/** Everything the widgets need to know about the chain they are pointed at. */
export interface ChainConfig {
  readonly chainId: number;
  readonly name: string;
  readonly nativeCurrency: NativeCurrencyConfig;
  readonly contracts: ContractAddresses;
  /**
   * viem transport for reads. Omitted when the host drives reads itself (for
   * example through wagmi) or when running against the mock adapter.
   */
  readonly transport?: Transport;
  readonly blockExplorerUrl?: string;
  /** Seconds added to `block.timestamp` for transaction deadlines. */
  readonly defaultDeadlineSeconds?: number;
}

/** Names of the addresses a caller can require. */
export type ContractName = keyof ContractAddresses;

/** Raised when the chain config cannot support a requested operation. */
export class ChainConfigError extends Error {
  readonly chainId: number;
  readonly contract: ContractName | null;

  constructor(message: string, chainId: number, contract: ContractName | null = null) {
    super(`[@latchprotocol/widgets] ${message}`);
    this.name = "ChainConfigError";
    this.chainId = chainId;
    this.contract = contract;
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";

function assertAddress(value: unknown, label: string, chainId: number, name: ContractName): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new ChainConfigError(
      `chain ${chainId}: ${label} is not a valid address: ${JSON.stringify(value)}`,
      chainId,
      name,
    );
  }
  const checksummed = getAddress(value);
  if (checksummed === ZERO) {
    throw new ChainConfigError(
      `chain ${chainId}: ${label} is the zero address. Pass the deployed address, ` +
        "or use the mock adapter if nothing is deployed yet.",
      chainId,
      name,
    );
  }
  return checksummed;
}

/**
 * Structural validation of a chain config.
 *
 * Checks shape only. It cannot tell you an address is wrong, just that it is
 * well-formed and present.
 */
export function assertValidChainConfig(config: ChainConfig): void {
  if (!Number.isInteger(config.chainId) || config.chainId <= 0) {
    throw new ChainConfigError(
      `chainId must be a positive integer, received ${String(config.chainId)}`,
      Number(config.chainId) || 0,
    );
  }
  if (config.nativeCurrency.decimals < 0 || config.nativeCurrency.decimals > 36) {
    throw new ChainConfigError(
      `nativeCurrency.decimals is out of range: ${config.nativeCurrency.decimals}`,
      config.chainId,
    );
  }
  assertAddress(config.contracts.vault, "contracts.vault", config.chainId, "vault");
  if (!config.contracts.clPoolManager && !config.contracts.binPoolManager) {
    throw new ChainConfigError(
      `chain ${config.chainId}: at least one of contracts.clPoolManager or ` +
        "contracts.binPoolManager must be set",
      config.chainId,
    );
  }
}

/**
 * Reads a required address, failing with a message that names what is missing
 * and which operation needed it.
 */
export function requireContract(
  config: ChainConfig,
  name: ContractName,
  usedFor: string,
): Address {
  const value = config.contracts[name];
  if (value === undefined) {
    throw new ChainConfigError(
      `chain ${config.chainId} (${config.name}): contracts.${name} is not configured, ` +
        `but it is required to ${usedFor}.`,
      config.chainId,
      name,
    );
  }
  return assertAddress(value, `contracts.${name}`, config.chainId, name);
}

/** Default transaction deadline: now + configured window, as a unix timestamp. */
export function defaultDeadline(config: ChainConfig, nowSeconds = Math.floor(Date.now() / 1000)): bigint {
  const window = config.defaultDeadlineSeconds ?? 20 * 60;
  return BigInt(nowSeconds + window);
}

/** Explorer link for a transaction hash, or `null` when no explorer is set. */
export function explorerTxUrl(config: ChainConfig, hash: string): string | null {
  if (!config.blockExplorerUrl) return null;
  return `${config.blockExplorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}
