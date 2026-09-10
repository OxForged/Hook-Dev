// SPDX-License-Identifier: MIT
/**
 * What a toolset is bound to: a chain, a deployment, an RPC client, and - only
 * if you explicitly ask - a signer.
 *
 * ## Defaults are the security posture
 *
 * `createLatchTools()` with no arguments gives you Sepolia, read-only, no key,
 * no write tools. Getting a tool that can send a transaction requires passing
 * `maintenance: { enabled: true, mode: "send" }` AND having the key in the
 * environment. Two independent conditions, exactly as `@latchprotocol/keeper`
 * does it, because the likeliest operational mistake is running the right code
 * in the wrong place.
 */

import { createPublicClient, createWalletClient, http, fallback, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { latchTransport } from "@latchprotocol/sdk";

import { DEFAULT_CHAIN_ID, deploymentFor, type LatchDeployment } from "./deployments.js";

/** How far a maintenance tool may go. */
export type MaintenanceMode =
  /** Read chain, simulate the call, report whether it would succeed. No key is
   * read, nothing is broadcast. This is the default when maintenance is on. */
  | "simulate"
  /** Simulate and then broadcast. Requires a key in the environment. */
  | "send";

export interface MaintenanceOptions {
  /** Off unless explicitly true. There is no way to enable this by accident. */
  readonly enabled: boolean;
  /** Default `"simulate"`. `"send"` additionally requires the key. */
  readonly mode?: MaintenanceMode;
  /**
   * Environment variable holding the signing key. Named rather than passed so a
   * key never travels through an options object, a log line or a stack trace.
   * Default `LATCH_AI_PRIVATE_KEY` - deliberately not the keeper's variable, so
   * pointing an agent at a machine that runs a keeper does not hand it that
   * keeper's key.
   */
  readonly privateKeyEnvVar?: string;
  /**
   * Refuse to broadcast a call whose simulated gas exceeds this. A pathological
   * loop in a contract we do not control should cost one failed check, not a
   * wallet. Default 2,000,000.
   */
  readonly maxGas?: bigint;
}

export interface LatchToolsOptions {
  /** Default: Sepolia, the only chain with a deployment. */
  readonly chainId?: number;
  /**
   * Bring your own client. When supplied, `rpcUrls` is ignored. Used by tests
   * and by hosts that already manage their own transport, retries and caching.
   */
  readonly publicClient?: PublicClient;
  /**
   * RPC endpoints, tried in order. When omitted the SDK's probed endpoint list
   * for the chain is used, with `LATCH_RPC_<chainId>` from the environment
   * taking precedence - the one supported way to point this at a private node.
   */
  readonly rpcUrls?: readonly string[];
  /** Off by default. See {@link MaintenanceOptions}. */
  readonly maintenance?: MaintenanceOptions;
}

export class UnsupportedChainError extends Error {
  constructor(public readonly chainId: number) {
    super(
      `Latch Protocol has no known deployment on chain ${chainId}. ` +
        `Deployed chains: see SUPPORTED_CHAIN_IDS.`,
    );
    this.name = "UnsupportedChainError";
  }
}

/** Everything a tool handler needs, resolved once at construction. */
export interface LatchContext {
  readonly chainId: number;
  readonly deployment: LatchDeployment;
  readonly publicClient: PublicClient;
  readonly maintenance: {
    readonly enabled: boolean;
    readonly mode: MaintenanceMode;
    readonly maxGas: bigint;
    /**
     * Resolves a signer at call time, not at construction. Returns undefined
     * when the mode is `simulate` or the variable is unset - which downgrades
     * the tool to a dry run rather than throwing, because a dry run is the safe
     * failure. Throws only when the variable is set to something malformed, and
     * never echoes the value, not even a prefix.
     */
    signer(): { walletClient: WalletClient; account: Address } | undefined;
  };
}

const DEFAULT_MAX_GAS = 2_000_000n;
const DEFAULT_KEY_ENV = "LATCH_AI_PRIVATE_KEY";

function buildPublicClient(chainId: number, rpcUrls?: readonly string[]): PublicClient {
  if (rpcUrls && rpcUrls.length > 0) {
    return createPublicClient({
      transport: fallback(
        rpcUrls.map((u) => http(u, { timeout: 15_000, retryCount: 2 })),
        { rank: false },
      ),
    });
  }
  // The SDK's transport already prefers `LATCH_RPC_<chainId>` from the
  // environment over its probed public list, so a private node is one env var
  // away and never needs to be written into code.
  return createPublicClient({
    transport: latchTransport(chainId, { env: process.env, rank: false }),
  });
}

/**
 * Read the signing key from the environment.
 *
 * The value is never logged, never returned, never put in an error message and
 * never written to disk. See CLAUDE.md, "Secrets".
 */
function readKey(envVar: string): Hex | undefined {
  const raw = process.env[envVar];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(`${envVar} is set but is not a 32-byte hex private key`);
  }
  return trimmed as Hex;
}

export function createContext(options: LatchToolsOptions = {}): LatchContext {
  const chainId = options.chainId ?? DEFAULT_CHAIN_ID;
  const deployment = deploymentFor(chainId);
  if (!deployment) throw new UnsupportedChainError(chainId);

  const publicClient = options.publicClient ?? buildPublicClient(chainId, options.rpcUrls);

  const m = options.maintenance;
  const enabled = m?.enabled === true;
  const mode: MaintenanceMode = enabled ? (m?.mode ?? "simulate") : "simulate";
  const envVar = m?.privateKeyEnvVar ?? DEFAULT_KEY_ENV;
  const maxGas = m?.maxGas ?? DEFAULT_MAX_GAS;

  return {
    chainId,
    deployment,
    publicClient,
    maintenance: {
      enabled,
      mode,
      maxGas,
      signer() {
        if (!enabled || mode !== "send") return undefined;
        const key = readKey(envVar);
        if (!key) return undefined;
        const account = privateKeyToAccount(key);
        return {
          walletClient: createWalletClient({
            account,
            transport: options.rpcUrls?.length
              ? fallback(options.rpcUrls.map((u) => http(u, { timeout: 15_000, retryCount: 2 })))
              : latchTransport(chainId, { env: process.env, rank: false }),
          }),
          account: account.address,
        };
      },
    },
  };
}
