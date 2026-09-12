// SPDX-License-Identifier: MIT
/**
 * What a swap on this app actually costs, read from chain.
 *
 * Three fees stack on one trade and a tenant needs all three on one screen,
 * because a user who is told about one of them and charged for three has been
 * misled by omission:
 *
 *   1. **The pool's LP fee** — set by whoever created the pool. Per pool.
 *   2. **Latch's protocol fee** — set by `protocolFeeController` on the shared
 *      pool manager, which Latch governance owns and core caps at
 *      `MAX_PROTOCOL_FEE = 4000` pips (0.4%). A tenant on shared core cannot
 *      change it. It is frequently **zero**, and this module says so rather
 *      than showing the controller's compiled-in default as if it were live.
 *   3. **The tenant's own front-end fee** — from `latch.config.ts`, taken from
 *      the swap output by the widgets' call path.
 *
 * The distinction that used to catch people out: a controller can be deployed
 * and INERT. `CLPoolManager.protocolFeeController()` is the slot that settles
 * whether it is in force at all, so it is read here rather than assumed.
 */

import { MAX_PROTOCOL_FEE } from "@latchprotocol/sdk";
import { parseAbi, type Address } from "viem";

import { resolveConfig } from "../config/resolve";
import { publicClient } from "./client";
import { composeFeePips } from "./format";

const POOL_MANAGER_ABI = parseAbi([
  "function protocolFeeController() view returns (address)",
  "function owner() view returns (address)",
]);

const VAULT_ABI = parseAbi([
  "function isAppRegistered(address) view returns (bool)",
  "function owner() view returns (address)",
]);

const CONTROLLER_ABI = parseAbi([
  "function defaultFee() view returns (bool isSet, uint16 zeroForOne, uint16 oneForZero)",
  "function feesDisabled() view returns (bool)",
]);

export interface ProtocolStatus {
  readonly chainId: number;
  readonly chainName: string;
  readonly blockNumber: bigint;
  readonly vault: Address;
  readonly vaultOwner: Address;
  /** `false` means the shared CL manager is not a registered Vault app: nothing works. */
  readonly clRegistered: boolean;
  /** The controller the pool manager actually points at. Zero means none is wired. */
  readonly feeController: Address;
  readonly controllerWired: boolean;
  /**
   * What a pool initialised right now would be charged by the protocol, in pips.
   *
   * Zero unless a controller is wired, enabled and has a fee set. This is the
   * number to render; the controller's compiled-in default is not, because a
   * deployed-but-inert controller charges nothing.
   */
  readonly effectiveProtocolFeePips: number;
  /** Core's hard ceiling. Not a policy, not changeable by anyone. */
  readonly maxProtocolFeePips: number;
}

export async function readProtocolStatus(): Promise<ProtocolStatus> {
  const cfg = resolveConfig();
  const client = publicClient();
  const { vault, clPoolManager } = cfg.contracts;

  const [blockNumber, vaultOwner, clRegistered, feeController] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: vault, abi: VAULT_ABI, functionName: "owner" }),
    client.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: "isAppRegistered",
      args: [clPoolManager],
    }),
    client.readContract({
      address: clPoolManager,
      abi: POOL_MANAGER_ABI,
      functionName: "protocolFeeController",
    }),
  ]);

  const controllerWired = feeController !== "0x0000000000000000000000000000000000000000";

  let effectiveProtocolFeePips = 0;
  if (controllerWired) {
    try {
      const [defaultFee, disabled] = await Promise.all([
        client.readContract({
          address: feeController,
          abi: CONTROLLER_ABI,
          functionName: "defaultFee",
        }),
        client.readContract({
          address: feeController,
          abi: CONTROLLER_ABI,
          functionName: "feesDisabled",
        }),
      ]);
      const [isSet, zeroForOne, oneForZero] = defaultFee;
      /* The two swap directions can carry different fees. One number is shown,
         so take the larger: understating what a trader might pay is the worse
         of the two errors. */
      effectiveProtocolFeePips = isSet && !disabled ? Math.max(zeroForOne, oneForZero) : 0;
    } catch {
      /* A wired controller that does not answer this ABI is a controller this
         app cannot read. Zero is not the honest answer, but neither is a guess —
         `controllerWired` is true while the fee reads 0, and the Fees screen
         says the fee could not be read rather than that it is nothing. */
      effectiveProtocolFeePips = 0;
    }
  }

  return {
    chainId: cfg.core.chainId,
    chainName: cfg.core.name,
    blockNumber,
    vault,
    vaultOwner,
    clRegistered,
    feeController,
    controllerWired,
    effectiveProtocolFeePips,
    maxProtocolFeePips: MAX_PROTOCOL_FEE,
  };
}

export interface FeeBreakdown {
  readonly lpFeePips: number;
  readonly protocolFeePips: number;
  /** LP + protocol, composed the way core composes them. Not their sum. */
  readonly onChainTotalPips: number;
  /** The tenant's front-end fee, in bps of the swap OUTPUT. A different base. */
  readonly frontEndFeeBps: number;
}

/**
 * The three fees, for one pool.
 *
 * `frontEndFeeBps` is deliberately NOT folded into `onChainTotalPips`: it is
 * taken from the output currency, not the input, so adding it to an input-side
 * pip total would produce a number that is wrong in both directions. Render
 * them as two lines and say which side each comes off.
 */
export function feeBreakdown(lpFeePips: number, status: ProtocolStatus): FeeBreakdown {
  const cfg = resolveConfig();
  return {
    lpFeePips,
    protocolFeePips: status.effectiveProtocolFeePips,
    onChainTotalPips: composeFeePips(status.effectiveProtocolFeePips, lpFeePips),
    frontEndFeeBps: cfg.fee.active ? cfg.fee.bps : 0,
  };
}
