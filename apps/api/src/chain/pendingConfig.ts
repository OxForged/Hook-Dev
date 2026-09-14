import { decodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

/**
 * RevShareHook.getPendingConfig — two struct shapes on chain, one decoder.
 *
 * Ported from `apps/web/src/lib/pendingConfig.ts` (same rules; the web module
 * cannot be imported by a Node service). Also mirrors
 * `packages/keeper/src/decode.ts`.
 *
 *   legacy   7 words (uint48 effectiveBlock, ConfigParams{6})     retired 0x23CE…E446
 *   current  8 words (uint48 effectiveBlock, uint48 expiryBlock, ConfigParams{6})  0xfC00…2aD2
 *
 * A typed ABI is right on exactly one of them (the 8-field decode of a 7-word
 * return throws; the 7-field decode of an 8-word return silently prints a block
 * number as a fee). So the call is raw and the decode is BY LENGTH. Anything
 * else throws. `expiryBlock` is null on legacy: that hook has NO expiry.
 *
 * Both block numbers are on the CONTRACT clock (Ethereum L1 on Robinhood).
 * Status must be judged against `readContractBlockNumber`, never eth_blockNumber.
 */

const SELECTOR_ABI = parseAbi(["function getPendingConfig(bytes32 poolId) view returns (bytes)"]);

const PARAMS = [
  { name: "feePips", type: "uint24" },
  { name: "lpDonateBps", type: "uint16" },
  { name: "beneficiaryBps", type: "uint16" },
  { name: "distributorBps", type: "uint16" },
  { name: "distributor", type: "address" },
  { name: "enabled", type: "bool" },
] as const;

const LEGACY = [
  { type: "tuple", components: [{ name: "effectiveBlock", type: "uint48" }, { name: "params", type: "tuple", components: PARAMS }] },
] as const;

const CURRENT = [
  {
    type: "tuple",
    components: [
      { name: "effectiveBlock", type: "uint48" },
      { name: "expiryBlock", type: "uint48" },
      { name: "params", type: "tuple", components: PARAMS },
    ],
  },
] as const;

export interface PendingParams {
  feePips: number;
  lpDonateBps: number;
  beneficiaryBps: number;
  distributorBps: number;
  distributor: Address;
  enabled: boolean;
}

export interface DecodedPendingConfig {
  shape: "legacy" | "current";
  effectiveBlock: bigint;
  expiryBlock: bigint | null;
  params: PendingParams;
}

export function encodeGetPendingConfig(poolId: Hex): Hex {
  return encodeFunctionData({ abi: SELECTOR_ABI, functionName: "getPendingConfig", args: [poolId] });
}

const toParams = (p: PendingParams): PendingParams => ({
  feePips: Number(p.feePips),
  lpDonateBps: Number(p.lpDonateBps),
  beneficiaryBps: Number(p.beneficiaryBps),
  distributorBps: Number(p.distributorBps),
  distributor: p.distributor.toLowerCase() as Address,
  enabled: p.enabled,
});

export function decodePendingConfig(data: Hex): DecodedPendingConfig {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) throw new Error("getPendingConfig returned non-hex data");
  const bytes = (data.length - 2) / 2;
  if (bytes % 32 !== 0) throw new Error(`getPendingConfig returned ${bytes} bytes, not whole words`);
  const words = bytes / 32;
  if (words === 7) {
    const [t] = decodeAbiParameters(LEGACY, data);
    return { shape: "legacy", effectiveBlock: BigInt(t.effectiveBlock), expiryBlock: null, params: toParams(t.params) };
  }
  if (words === 8) {
    const [t] = decodeAbiParameters(CURRENT, data);
    return { shape: "current", effectiveBlock: BigInt(t.effectiveBlock), expiryBlock: BigInt(t.expiryBlock), params: toParams(t.params) };
  }
  throw new Error(`getPendingConfig returned ${words} words; only 7 (legacy) and 8 (current) are known`);
}

export type ProposalStatusName = "NONE" | "QUEUED" | "ARMED" | "EXPIRED";

/** `contractBlockNumber` MUST come from the SDK's readContractBlockNumber. */
export function proposalStatus(p: Pick<DecodedPendingConfig, "effectiveBlock" | "expiryBlock">, contractBlockNumber: bigint): ProposalStatusName {
  if (p.effectiveBlock === 0n) return "NONE";
  if (contractBlockNumber < p.effectiveBlock) return "QUEUED";
  if (p.expiryBlock !== null && contractBlockNumber > p.expiryBlock) return "EXPIRED";
  return "ARMED";
}
