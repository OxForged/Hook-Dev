import { parseAbi } from "viem";
import type { Hex } from "viem";

/**
 * Contract roles the ingestion pipeline knows how to decode.
 *
 * WHY THE ROLE IS MANDATORY, NOT A CONVENIENCE:
 *
 * topic0 does not identify an event in this protocol. Across Vault,
 * CLPoolManager, BinPoolManager and the shared ProtocolFees base there are 34
 * event declarations but only 22 distinct signatures. `ProtocolFees` is
 * inherited by BOTH pool managers, so these are byte-identical and collide:
 *
 *   OwnershipTransferred(address,address)      x4
 *   Paused(address)                            x3
 *   Unpaused(address)                          x3
 *   ProtocolFeeUpdated(bytes32,uint24)         x3
 *   ProtocolFeeControllerUpdated(address)      x3
 *   DynamicLPFeeUpdated(bytes32,uint24)        x2
 *
 * A `ProtocolFeeUpdated` log therefore cannot be attributed to CL or bin
 * activity from its topics alone — only the emitting address distinguishes
 * them. Every lookup in this pipeline is keyed on
 * `(chainId, contractAddress, topic0)`, and the emitting address is persisted
 * on every event row so the distinction survives into the database.
 */
export type ContractRole = "Vault" | "CLPoolManager" | "BinPoolManager" | "FeeController";

/** Roles whose ABIs live in @latchprotocol/sdk. */
export type SdkContractRole = Exclude<ContractRole, "FeeController">;

export function isSdkRole(role: ContractRole): role is SdkContractRole {
  return role !== "FeeController";
}

/** One deployed contract on one chain. */
export interface ContractRef {
  readonly chainId: number;
  readonly role: ContractRole;
  /** Lowercased 0x address. */
  readonly address: Hex;
  /** Human label used in cursors and logs, e.g. "CLPoolManager". */
  readonly label: string;
}

/**
 * Event ABI for `LatchProtocolFeeController` (packages/fees).
 *
 * This one is hand-declared rather than taken from the SDK because the SDK's
 * generator covers packages/core only. Verified against
 * `packages/fees/foundry-out/LatchProtocolFeeController.sol/LatchProtocolFeeController.json`.
 */
export const FEE_CONTROLLER_EVENTS_ABI = parseAbi([
  "event DefaultFeeUpdated(uint16 zeroForOne, uint16 oneForZero)",
  "event PoolFeeUpdated(bytes32 indexed poolId, bool isSet, uint16 zeroForOne, uint16 oneForZero)",
  "event TierFeeUpdated(uint24 indexed lpFeeTier, bool isSet, uint16 zeroForOne, uint16 oneForZero)",
  "event DynamicFeeUpdated(bool isSet, uint16 zeroForOne, uint16 oneForZero)",
  "event FeesDisabledSet(bool disabled)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)",
]);

/**
 * Protocol-fee constants from `LatchProtocolFeeController` (packages/fees).
 *
 * `MAX_PROTOCOL_FEE` and the pips denominator also exist in the SDK; the two
 * controller-specific values do not, because the SDK covers packages/core only.
 */
export const PROTOCOL_FEE = {
  /** Denominator for protocol fee pips. */
  PIPS_DENOMINATOR: 1_000_000,
  /** MAX_PROTOCOL_FEE = 4000 pips = 0.4%, per swap direction. */
  MAX_PROTOCOL_FEE_PIPS: 4_000,
  /** DEFAULT_FEE_PIPS = 1000 pips = 0.1%. */
  DEFAULT_FEE_PIPS: 1_000,
} as const;

export function normalizeAddress(address: string): Hex {
  return address.toLowerCase() as Hex;
}

/** Stable cursor id for one (chain, contract) pair. */
export function cursorId(chainId: number, address: string): string {
  return `${chainId}-${normalizeAddress(address)}`;
}
