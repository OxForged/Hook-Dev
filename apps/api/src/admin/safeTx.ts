import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import {
  FEE_CONTROLLER_V2_FUNCTIONS_ABI,
  OWNABLE2STEP_FUNCTIONS_ABI,
  REGISTRY_FUNCTIONS_ABI,
  REGISTRY_LISTING,
  REGISTRY_MAX_NOTE_BYTES,
  TIMELOCK_FUNCTIONS_ABI,
} from "../chain/abis.js";

/**
 * Transaction PAYLOADS for humans to sign elsewhere (Safe{Wallet}, a hardware
 * wallet, the Safe CLI). This module has no key, no client and no send path, by
 * construction: the admin API prepares, humans sign. `test/noKey.test.ts` scans
 * src/ for signing and sending primitives and fails if one appears.
 *
 * `nonce` is deliberately absent. It must be read from the Safe at signing time;
 * a nonce baked in here would go stale the moment any other Safe tx lands, and a
 * signature over a stale nonce is either useless or, worse, valid later.
 */

export interface DecodedCall {
  functionName: string;
  signature: string;
  args: { name: string; type: string; value: string | string[] }[];
}

export interface SafeTxPayload {
  kind: "safe";
  chainId: number;
  safe: Address;
  to: Address;
  value: string;
  data: Hex;
  operation: 0;
  safeTxGas: "0";
  baseGas: "0";
  gasPrice: "0";
  gasToken: Address;
  refundReceiver: Address;
  description: string;
  decoded: DecodedCall | null;
  warnings: string[];
}

/** A plain transaction a role holder sends from their own wallet (not the Safe). */
export interface DirectTxPayload {
  kind: "direct";
  chainId: number;
  from: Address;
  to: Address;
  value: string;
  data: Hex;
  description: string;
  decoded: DecodedCall | null;
  warnings: string[];
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const stringify = (v: unknown): string | string[] =>
  Array.isArray(v) ? v.map((x) => String(typeof x === "bigint" ? x.toString() : x)) : typeof v === "bigint" ? v.toString() : String(v);

/** Human decode of calldata against an ABI. Null when the selector is not in it. */
export function decodeCall(abi: Abi, data: Hex): DecodedCall | null {
  try {
    const d = decodeFunctionData({ abi, data });
    const fn = abi.find((x) => x.type === "function" && x.name === d.functionName) as { name: string; inputs: readonly { name?: string; type: string }[] } | undefined;
    if (!fn) return null;
    const args = (d.args ?? []) as readonly unknown[];
    return {
      functionName: d.functionName,
      signature: `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})`,
      args: fn.inputs.map((i, n) => ({ name: i.name ?? `arg${n}`, type: i.type, value: stringify(args[n]) })),
    };
  } catch {
    return null;
  }
}

export function buildSafeTransaction(p: { chainId: number; safe: string; to: string; data: Hex; value?: bigint; description: string; decoded?: DecodedCall | null; warnings?: string[] }): SafeTxPayload {
  if (!isAddress(p.safe) || !isAddress(p.to)) throw new Error("safe and to must be addresses");
  if (p.to.toLowerCase() === ZERO) throw new Error("refusing a Safe transaction to the zero address");
  return {
    kind: "safe",
    chainId: p.chainId,
    safe: getAddress(p.safe),
    to: getAddress(p.to),
    value: (p.value ?? 0n).toString(),
    data: p.data,
    // CALL only. DELEGATECALL from the governance Safe runs foreign code with the
    // Safe's storage and authority; this builder never produces one.
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ZERO,
    refundReceiver: ZERO,
    description: p.description,
    decoded: p.decoded ?? null,
    warnings: p.warnings ?? [],
  };
}

/** The Safe{Wallet} home URL for a Safe, with the chain's EIP-3770 short name. Opens the app; signs nothing. */
export function safeAppUrl(shortName: string, safe: string): string {
  if (!/^[a-z0-9-]{1,32}$/.test(shortName) || !isAddress(safe)) throw new Error("bad Safe app parameters");
  return `https://app.safe.global/home?safe=${shortName}:${getAddress(safe)}`;
}

/* ---------------------------------------------------------------------------
   Fee controller V2
   --------------------------------------------------------------------------- */

/**
 * LatchProtocolFeeControllerV2.collect(poolManager, currency, amount, recipient)
 * — owner-only on the controller (the Safe). amount 0 collects everything accrued.
 */
export function prepareCollectProtocolFees(p: {
  chainId: number;
  safe: string;
  feeController: string;
  poolManager: string;
  currency: string;
  amount: bigint;
  recipient: string;
}): SafeTxPayload {
  if (!isAddress(p.recipient) || p.recipient.toLowerCase() === ZERO) throw new Error("recipient must be a non-zero address");
  if (p.amount < 0n) throw new Error("amount must be >= 0");
  const data = encodeFunctionData({
    abi: FEE_CONTROLLER_V2_FUNCTIONS_ABI,
    functionName: "collect",
    args: [getAddress(p.poolManager), getAddress(p.currency), p.amount, getAddress(p.recipient)],
  });
  const warnings: string[] = [];
  if (p.recipient.toLowerCase() !== p.safe.toLowerCase()) {
    warnings.push("Recipient is not the governance Safe. CLAUDE.md: protocol fees go to the Safe; no separate treasury address.");
  }
  return buildSafeTransaction({
    chainId: p.chainId,
    safe: p.safe,
    to: p.feeController,
    data,
    decoded: decodeCall(FEE_CONTROLLER_V2_FUNCTIONS_ABI as unknown as Abi, data),
    description: `collect(${p.poolManager}, ${p.currency}, ${p.amount === 0n ? "all accrued" : p.amount.toString()}, ${p.recipient})`,
    warnings,
  });
}

/**
 * LatchProtocolFeeControllerV2.sweep(poolManager, currency) — PERMISSIONLESS; pays
 * only the stored `treasury`. Prepared as a Safe transaction for convenience; any
 * account (the keeper does, every 12 h) may send the same calldata.
 */
export function prepareSweep(p: { chainId: number; safe: string; feeController: string; poolManager: string; currency: string }): SafeTxPayload {
  const data = encodeFunctionData({ abi: FEE_CONTROLLER_V2_FUNCTIONS_ABI, functionName: "sweep", args: [getAddress(p.poolManager), getAddress(p.currency)] });
  return buildSafeTransaction({
    chainId: p.chainId,
    safe: p.safe,
    to: p.feeController,
    data,
    decoded: decodeCall(FEE_CONTROLLER_V2_FUNCTIONS_ABI as unknown as Abi, data),
    description: `sweep(${p.poolManager}, ${p.currency}) -> stored treasury`,
    warnings: ["sweep is permissionless and pays only treasury(); the keeper already calls it every 12 h. Signing it from the Safe spends a Safe nonce for something any account can do."],
  });
}

/* ---------------------------------------------------------------------------
   Timelock: execute an operation that is ALREADY QUEUED

   CLAUDE.md "VERIFIED LIVE STATE": the custody handover fix is already scheduled
   as three single operations (block 61,325,176). This module deliberately has NO
   schedule/scheduleBatch builder for it: a second schedule would duplicate the
   queued operations. The earlier batch (salt 0xfdd6…ae74) was never sent and is
   discarded.
   --------------------------------------------------------------------------- */

/** OpenZeppelin TimelockController.hashOperation, computed locally. */
export function hashOperation(target: Address, value: bigint, data: Hex, predecessor: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }], [target, value, data, predecessor, salt]),
  );
}

export const ACCEPT_OWNERSHIP_SELECTOR: Hex = encodeFunctionData({ abi: OWNABLE2STEP_FUNCTIONS_ABI, functionName: "acceptOwnership" });

/**
 * The three operations CLAUDE.md records as queued on the Robinhood custody
 * timelock. NOT the source of truth: the panel reads operations from indexed
 * CallScheduled/CallSalt events. This table exists so a test can pin the exact
 * execute() calldata against the recorded ids, and so the execute builder can
 * cross-check a salt the indexer has not stored yet (the id commits to the
 * salt, so a wrong one fails the re-hash rather than producing a bad payload).
 */
export const RECORDED_ACCEPT_OWNERSHIP_OPERATIONS = {
  chainId: 4663,
  timelock: "0x3aE354e2cdFB9Cb855ABA41c825F6Ee53f28e119",
  scheduledAtBlock: 61_325_176n,
  delaySeconds: 172_800n,
  readyAtUnix: 1_789_411_243,
  operations: [
    { contract: "vault", target: "0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c", id: "0xb04e05ca3f8018246e91f8c15d2d3e4f2108afb9b44b3961e90573f026d5f33d", salt: "0xe17bfec589d6a2594c2d59f7a1455e637425f2d5a4cbbcdf9062e39fad16e555" },
    { contract: "clPoolManagerOwner", target: "0x5D7111d6c624e9a08aE63d342E4baE5878989a67", id: "0xab9c8f8e5fc6f02fafbc903847adccebca65b5811f5489993d9c0033721ebf00", salt: "0xb0ecc7113374d7c91a718f0d7a67a59bbf2efaaaf0f6c3a209b541cb4e3de097" },
    { contract: "binPoolManagerOwner", target: "0x98920e33313257Ffd942f94379A7ced216462665", id: "0x700f7b00af4f2d2109587a37f6dc3b12477e074385fa1e23a72f482ea1be4f6e", salt: "0x4787d44da9b61fa3107ab9bd0ef45f807be8debdaa46b66a2ae96ceb458a62c1" },
  ],
} as const;

export interface ExecuteOperationPayload {
  operationId: Hex;
  /** Recomputed locally from (target, value, data, predecessor, salt). Must equal operationId. */
  recomputedId: Hex;
  saltSource: "indexed CallSalt event" | "CLAUDE.md record (verified by re-hash)";
  /** Anyone may send: EXECUTOR_ROLE is address(0). */
  direct: DirectTxPayload;
  /** The same call as a Safe transaction, for a Safe that prefers to send it itself. */
  safeTx: SafeTxPayload;
}

/**
 * TimelockController.execute(target, value, payload, predecessor, salt) for one
 * queued single-call operation. Refuses unless the arguments hash to the id.
 */
export function prepareExecuteOperation(p: {
  chainId: number;
  timelock: string;
  safe: string;
  from: string;
  operationId: string;
  target: string;
  value: bigint;
  data: Hex;
  predecessor: Hex;
  salt: Hex;
  saltSource: ExecuteOperationPayload["saltSource"];
  description: string;
}): ExecuteOperationPayload {
  const target = getAddress(p.target);
  const recomputedId = hashOperation(target, p.value, p.data, p.predecessor, p.salt);
  if (recomputedId.toLowerCase() !== p.operationId.toLowerCase()) {
    throw new Error(`arguments hash to ${recomputedId}, not operation ${p.operationId}; refusing to build execute()`);
  }
  const data = encodeFunctionData({ abi: TIMELOCK_FUNCTIONS_ABI, functionName: "execute", args: [target, p.value, p.data, p.predecessor, p.salt] });
  const decoded = decodeCall(TIMELOCK_FUNCTIONS_ABI as unknown as Abi, data);
  const warnings = [
    "Succeeds only once the operation is READY (isOperationReady). Before that it reverts TimelockUnexpectedOperationState.",
    "Afterwards, re-read owner() on the target: that read, not this transaction, is the proof.",
  ];
  return {
    operationId: p.operationId.toLowerCase() as Hex,
    recomputedId,
    saltSource: p.saltSource,
    direct: { kind: "direct", chainId: p.chainId, from: getAddress(p.from), to: getAddress(p.timelock), value: p.value.toString(), data, decoded, description: p.description, warnings },
    safeTx: buildSafeTransaction({ chainId: p.chainId, safe: p.safe, to: p.timelock, data, value: p.value, decoded, description: p.description, warnings }),
  };
}

/* ---------------------------------------------------------------------------
   Registry: flag / unflag a malicious Latch (curator or guardian, direct call)
   --------------------------------------------------------------------------- */

export type ListingAction = "flag" | "unflag";

/**
 * LatchRegistry.setListing(hook, status, reason) sent DIRECTLY by a role holder
 * (CLAUDE.md Ownership table: CURATOR_ROLE and GUARDIAN_ROLE are Ops keys, not
 * the Safe — a queue on "this Latch is draining people" makes the flag useless).
 *
 *   flag    -> Malicious (2). Curator or guardian. Also force-resets verification.
 *   unflag  -> Active (0). Curator only: a guardian may never relist.
 */
export function prepareRegistryListing(p: { chainId: number; registry: string; from: string; hook: string; action: ListingAction; reason: string }): DirectTxPayload {
  if (!isAddress(p.hook) || p.hook.toLowerCase() === ZERO) throw new Error("hook must be a non-zero address");
  if (!isAddress(p.from)) throw new Error("from must be an address");
  const reason = p.reason.trim();
  const bytes = new TextEncoder().encode(reason).length;
  if (bytes === 0) throw new Error("a reason is required: it is what a marketplace shows next to the warning");
  if (bytes > REGISTRY_MAX_NOTE_BYTES) throw new Error(`reason is ${bytes} bytes; LatchRegistry.MAX_NOTE_BYTES is ${REGISTRY_MAX_NOTE_BYTES}`);
  const status = p.action === "flag" ? REGISTRY_LISTING.Malicious : REGISTRY_LISTING.Active;
  const data = encodeFunctionData({ abi: REGISTRY_FUNCTIONS_ABI, functionName: "setListing", args: [getAddress(p.hook), status, reason] });
  return {
    kind: "direct",
    chainId: p.chainId,
    from: getAddress(p.from),
    to: getAddress(p.registry),
    value: "0",
    data,
    decoded: decodeCall(REGISTRY_FUNCTIONS_ABI as unknown as Abi, data),
    description: p.action === "flag" ? `setListing(${p.hook}, Malicious, reason)` : `setListing(${p.hook}, Active, reason)`,
    warnings:
      p.action === "flag"
        ? ["Flagging Malicious also resets verification to Unverified in the same transaction. A curator can reverse the listing; the demotion stays."]
        : ["Unflag is curator-only: a guardian-only key reverts GuardianCannotRelist. Restoring does not restore a verification badge."],
  };
}
