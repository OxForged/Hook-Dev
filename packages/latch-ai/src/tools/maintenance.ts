// SPDX-License-Identifier: MIT
/**
 * `latch_maintenance` - the ONLY tool in this package that can send a
 * transaction, and it is absent unless you deliberately turn it on.
 *
 * ## The boundary, stated once
 *
 * This tool can call exactly four functions:
 *
 *   `closeEpoch()`  `rollover(epochId)`  `settleBeneficiaries(key, currency)`
 *   `applyPendingConfig(key)`
 *
 * All four are **permissionless on chain**: any address may call them from
 * anywhere, and none of them can direct value to the caller. They are the calls
 * that must happen for revenue to keep moving - an epoch that never closes is
 * an epoch nobody can claim from - and they are the same four
 * `@latchprotocol/keeper` makes.
 *
 * What is NOT here, and must never be added:
 *
 * - anything `onlyOwner`, `onlyCurator`, `onlyGuardian` or otherwise privileged;
 * - anything that moves a user's funds: no swap, no add or remove liquidity, no
 *   claim, no approve, no transfer;
 * - anything on the registry: no register, no setVerification, no setListing;
 * - anything on the Vault, including `registerApp`, which is irreversible.
 *
 * If a future capability needs a privileged role, it does not belong in a
 * package an LLM drives. That is not a policy about this version; it is the
 * reason the package can be given a key at all.
 *
 * ## What a stolen `LATCH_AI_PRIVATE_KEY` buys an attacker
 *
 * Nothing they could not already do from any address. They can close an epoch
 * slightly earlier than you would have, or waste the key's gas. They cannot
 * move funds, change a fee, alter a roster, or touch a listing. The key should
 * be a dedicated address holding only gas.
 *
 * ## Three gates before anything is broadcast
 *
 * 1. `maintenance.enabled === true` at construction, or the tool does not exist.
 * 2. `maintenance.mode === "send"`, or every call is a simulation.
 * 3. The key is present in the environment, or every call is a simulation.
 *
 * And on every call, whatever the gates say: the on-chain preconditions are
 * read first, then the call is SIMULATED, and a broadcast happens only if the
 * simulation succeeded and the simulated gas is under `maxGas`. Every
 * contract-side guard (`EpochTooSoon`, `NothingToDistribute`,
 * `AlreadyRolledOver`, `ClaimWindowClosed`) is a revert, so simulating turns
 * all of them into free reads and a revert reads as "not due" - which is the
 * normal state most of the time.
 */

import type { Address, Hex } from "viem";

import {
  DISTRIBUTOR_ABI,
  EPOCH_FIELD,
  MERKLE_EPOCH_ABI,
  REV_SHARE_HOOK_ABI,
  SNAPSHOT_EPOCH_ABI,
  type DistributorKind,
  type EpochTuple,
} from "../abi.js";

/**
 * Which distributor is this? There is no `kind()` on chain and the two share no
 * interface, so each is asked a question only it can answer: `token()` exists
 * only on the snapshot distributor, `challengeDelay()` only on the merkle one.
 *
 * Exactly one must answer. Both or neither returns `unknown`, and the caller
 * must stop rather than guess — the wrong `getEpoch` ABI decodes cleanly into
 * nonsense, so guessing produces a confident wrong answer, which for a tool an
 * agent relies on is worse than no answer at all.
 */
async function probeDistributorKind(
  ctx: { publicClient: { readContract: (a: never) => Promise<unknown> } },
  distributor: Address,
): Promise<DistributorKind> {
  const [snap, merk] = await Promise.allSettled([
    ctx.publicClient.readContract({
      address: distributor,
      abi: DISTRIBUTOR_ABI,
      functionName: "token",
    } as never),
    ctx.publicClient.readContract({
      address: distributor,
      abi: DISTRIBUTOR_ABI,
      functionName: "challengeDelay",
    } as never),
  ]);
  const isSnap = snap.status === "fulfilled";
  const isMerk = merk.status === "fulfilled";
  if (isSnap && !isMerk) return "snapshot";
  if (isMerk && !isSnap) return "merkle";
  return "unknown";
}
import type { LatchContext } from "../context.js";
import { toJson } from "../json.js";
import { err, ok, type LatchTool, type ToolResult } from "../types.js";
import {
  asRecord,
  InputError,
  requireAddressField,
  requireBytes32Field,
  requireEnumField,
  requireIntField,
  shortMessage,
  toToolError,
} from "./common.js";

const ACTIONS = ["closeEpoch", "rollover", "settleBeneficiaries", "applyPendingConfig"] as const;
type Action = (typeof ACTIONS)[number];

const CAVEATS: readonly string[] = [
  "All four calls are permissionless on chain: anyone may make them from any address, and none can direct value to the caller. This tool holds no privileged role and must never be given one.",
  "A simulation revert means 'not due yet', which is the normal state most of the time. It is not an error and not a reason to retry with different arguments.",
  "A broadcast transaction is not a confirmed one. The result reports the hash; verify inclusion before acting on it.",
];

interface PoolKeyInput {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly hooks: Address;
  readonly poolManager: Address;
  readonly fee: number;
  readonly parameters: Hex;
}

function requirePoolKey(input: Record<string, unknown>): PoolKeyInput {
  const k = input["poolKey"];
  if (typeof k !== "object" || k === null) {
    throw new InputError('"poolKey" is required for this action and must be an object');
  }
  const r = k as Record<string, unknown>;
  return {
    currency0: requireAddressField(r, "currency0"),
    currency1: requireAddressField(r, "currency1"),
    hooks: requireAddressField(r, "hooks"),
    poolManager: requireAddressField(r, "poolManager"),
    fee: requireIntField(r, "fee", 0, 0xffffff),
    parameters: requireBytes32Field(r, "parameters"),
  };
}

/** viem wants the PoolKey struct positionally, in this exact order. */
function poolKeyTuple(k: PoolKeyInput) {
  return [k.currency0, k.currency1, k.hooks, k.poolManager, k.fee, k.parameters] as const;
}

interface Outcome {
  readonly action: Action;
  readonly target: Address;
  readonly due: boolean;
  readonly wouldSucceed: boolean;
  readonly sent: boolean;
  readonly reason: string;
  readonly txHash?: string;
  readonly simulatedGas?: string;
}

export function maintenanceTool(ctx: LatchContext): LatchTool {
  return {
    name: "latch_maintenance",
    access: ctx.maintenance.mode === "send" ? "write" : "simulate",
    returnsUntrustedText: false,
    description:
      "Run one of Latch Protocol's four permissionless maintenance calls, or check whether it is due: " +
      "closeEpoch (close a revenue epoch so it can be claimed), rollover (return an expired epoch's " +
      "unclaimed funds to the next one), settleBeneficiaries (push accrued fees to a pool's beneficiary " +
      "roster), applyPendingConfig (apply a config change whose delay has elapsed). " +
      "All four are callable by anyone from any address and none can direct value to the caller. " +
      "The on-chain preconditions are read first and the call is always simulated before anything is " +
      "sent; a revert during simulation means 'not due yet', which is normal. " +
      "This tool cannot call any owner-, curator- or guardian-only function, cannot swap, cannot move " +
      "liquidity, and cannot touch the registry or the Vault. " +
      (ctx.maintenance.mode === "send"
        ? "This toolset is configured to BROADCAST when a call is due and a signing key is present."
        : "This toolset is configured to SIMULATE ONLY: it will report whether a call would succeed and will not broadcast anything."),
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Which maintenance call to check and, if enabled, make. `closeEpoch` and `rollover` need `distributor`; `settleBeneficiaries` and `applyPendingConfig` need `hook`, `poolId` and `poolKey`.",
          enum: [...ACTIONS],
        },
        distributor: {
          type: "string",
          description:
            "Epoch distributor address. Required for closeEpoch and rollover. Works for either the snapshot or the merkle distributor - they share these signatures.",
        },
        epochId: {
          type: "integer",
          description: "Which epoch to roll over. Required for rollover.",
          minimum: 0,
        },
        hook: {
          type: "string",
          description: "RevShareHook address. Required for settleBeneficiaries and applyPendingConfig.",
        },
        poolId: {
          type: "string",
          description:
            "32-byte pool id, used to read the pending amount before deciding whether the call is worth making. Required for settleBeneficiaries and applyPendingConfig.",
        },
        currency: {
          type: "string",
          description: "Which currency to settle. Required for settleBeneficiaries.",
        },
        poolKey: {
          type: "object",
          description:
            "The full pool key the call takes: currency0, currency1, hooks, poolManager (all addresses), fee (uint24) and parameters (32-byte hex). Required for settleBeneficiaries and applyPendingConfig.",
          properties: {
            currency0: { type: "string", description: "First currency address (sorted order)." },
            currency1: { type: "string", description: "Second currency address (sorted order)." },
            hooks: { type: "string", description: "Hook address attached to the pool." },
            poolManager: { type: "string", description: "CL or Bin pool manager address." },
            fee: { type: "integer", description: "LP fee in pips (uint24)." },
            parameters: {
              type: "string",
              description: "Packed parameters word, 32-byte hex, carrying the hook bitmap and tick spacing.",
            },
          },
          required: ["currency0", "currency1", "hooks", "poolManager", "fee", "parameters"],
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async handler(input): Promise<ToolResult> {
      if (!ctx.maintenance.enabled) {
        // Unreachable through the default toolset - the tool is not built at
        // all unless maintenance is enabled - but kept as a second gate so a
        // hand-assembled toolset cannot bypass the first.
        return err(
          "not_enabled",
          "Maintenance calls are disabled for this toolset. Construct it with maintenance: { enabled: true } to allow them.",
        );
      }

      try {
        const raw = asRecord(input);
        const action = requireEnumField(raw, "action", ACTIONS);
        const outcome = await run(ctx, action, raw);
        return ok(
          toJson({
            chainId: ctx.chainId,
            mode: ctx.maintenance.mode,
            ...outcome,
          }),
          CAVEATS,
        );
      } catch (e) {
        return toToolError(e);
      }
    },
  };
}

async function run(
  ctx: LatchContext,
  action: Action,
  raw: Record<string, unknown>,
): Promise<Outcome> {
  switch (action) {
    case "closeEpoch":
      return closeEpoch(ctx, requireAddressField(raw, "distributor"));
    case "rollover":
      return rollover(
        ctx,
        requireAddressField(raw, "distributor"),
        BigInt(requireIntField(raw, "epochId", 0, Number.MAX_SAFE_INTEGER)),
      );
    case "settleBeneficiaries":
      return settleBeneficiaries(
        ctx,
        requireAddressField(raw, "hook"),
        requireBytes32Field(raw, "poolId"),
        requireAddressField(raw, "currency"),
        requirePoolKey(raw),
      );
    case "applyPendingConfig":
      return applyPendingConfig(
        ctx,
        requireAddressField(raw, "hook"),
        requireBytes32Field(raw, "poolId"),
        requirePoolKey(raw),
      );
  }
}

/**
 * Simulate, then broadcast only if all three gates and the gas ceiling allow it.
 *
 * The order is load-bearing: nothing is ever sent that did not simulate against
 * the current block first.
 */
async function simulateThenMaybeSend(
  ctx: LatchContext,
  action: Action,
  target: Address,
  abi: typeof DISTRIBUTOR_ABI | typeof REV_SHARE_HOOK_ABI,
  functionName: string,
  args: readonly unknown[],
): Promise<Outcome> {
  const signer = ctx.maintenance.signer();

  let request: unknown;
  try {
    const sim = await ctx.publicClient.simulateContract({
      address: target,
      abi: abi as never,
      functionName: functionName as never,
      args: args as never,
      ...(signer ? { account: signer.account } : {}),
    });
    request = sim.request;
  } catch (e) {
    return {
      action,
      target,
      due: false,
      wouldSucceed: false,
      sent: false,
      reason: `not due - the call reverted in simulation: ${shortMessage(e)}`,
    };
  }

  // Gas is estimated separately so a pathological contract costs one failed
  // check rather than a wallet. A failure to estimate is not a reason to send.
  let gas: bigint | undefined;
  try {
    gas = await ctx.publicClient.estimateContractGas({
      address: target,
      abi: abi as never,
      functionName: functionName as never,
      args: args as never,
      ...(signer ? { account: signer.account } : {}),
    });
  } catch {
    gas = undefined;
  }

  const base = {
    action,
    target,
    due: true,
    wouldSucceed: true,
    ...(gas === undefined ? {} : { simulatedGas: gas.toString(10) }),
  } as const;

  if (!signer) {
    return {
      ...base,
      sent: false,
      reason:
        ctx.maintenance.mode === "send"
          ? "DUE and simulated clean, but no signing key is present in the environment, so nothing was sent."
          : "DUE and simulated clean. This toolset is in simulate-only mode; nothing was sent.",
    };
  }

  if (gas !== undefined && gas > ctx.maintenance.maxGas) {
    return {
      ...base,
      sent: false,
      reason: `DUE and simulated clean, but the estimated gas (${gas}) exceeds the configured ceiling (${ctx.maintenance.maxGas}). Nothing was sent.`,
    };
  }

  const hash = await signer.walletClient.writeContract(request as never);
  return { ...base, sent: true, txHash: hash, reason: "DUE - transaction broadcast." };
}

async function closeEpoch(ctx: LatchContext, distributor: Address): Promise<Outcome> {
  const [lastCloseAt, minDuration, epochCount, block] = await Promise.all([
    ctx.publicClient.readContract({
      address: distributor,
      abi: DISTRIBUTOR_ABI,
      functionName: "lastCloseAt",
    }) as Promise<bigint>,
    ctx.publicClient.readContract({
      address: distributor,
      abi: DISTRIBUTOR_ABI,
      functionName: "minEpochDuration",
    }) as Promise<bigint>,
    ctx.publicClient.readContract({
      address: distributor,
      abi: DISTRIBUTOR_ABI,
      functionName: "epochCount",
    }) as Promise<bigint>,
    ctx.publicClient.getBlock(),
  ]);

  // Reported explicitly rather than left to the simulation revert: "not due for
  // 4h" is a usable answer, "EpochTooSoon" is not.
  if (epochCount > 0n) {
    const earliest = lastCloseAt + minDuration;
    if (block.timestamp < earliest) {
      return {
        action: "closeEpoch",
        target: distributor,
        due: false,
        wouldSucceed: false,
        sent: false,
        reason: `not due for another ${earliest - block.timestamp} seconds (minimum epoch duration has not elapsed).`,
      };
    }
  }

  return simulateThenMaybeSend(ctx, "closeEpoch", distributor, DISTRIBUTOR_ABI, "closeEpoch", []);
}

async function rollover(
  ctx: LatchContext,
  distributor: Address,
  epochId: bigint,
): Promise<Outcome> {
  const [count, block] = await Promise.all([
    ctx.publicClient.readContract({
      address: distributor,
      abi: DISTRIBUTOR_ABI,
      functionName: "epochCount",
    }) as Promise<bigint>,
    ctx.publicClient.getBlock(),
  ]);

  if (epochId >= count) {
    return {
      action: "rollover",
      target: distributor,
      due: false,
      wouldSucceed: false,
      sent: false,
      reason: `epoch ${epochId} does not exist; the distributor has closed ${count} epoch(s).`,
    };
  }

  // Read the epoch through the ABI that matches THIS distributor. Using one
  // shared shape would decode without error and silently reinterpret fields
  // 4-6; see the table above SNAPSHOT_EPOCH_ABI in ../abi.ts.
  const kind = await probeDistributorKind(ctx, distributor);
  if (kind === "unknown") {
    return {
      action: "rollover",
      target: distributor,
      due: false,
      wouldSucceed: false,
      sent: false,
      reason:
        "could not determine whether this is a snapshot or merkle distributor - it answered both or neither of token() and challengeDelay(). Refusing to read the epoch, because the wrong ABI decodes into plausible nonsense rather than failing.",
    };
  }

  const epoch = (await ctx.publicClient.readContract({
    address: distributor,
    abi: kind === "snapshot" ? SNAPSHOT_EPOCH_ABI : MERKLE_EPOCH_ABI,
    functionName: "getEpoch",
    args: [epochId],
  })) as unknown as EpochTuple;

  if (epoch[EPOCH_FIELD.rolledOver]) {
    return {
      action: "rollover",
      target: distributor,
      due: false,
      wouldSucceed: false,
      sent: false,
      reason: `epoch ${epochId} has already been rolled over.`,
    };
  }

  const expiresAt = epoch[EPOCH_FIELD.expiresAt];
  if (block.timestamp < expiresAt) {
    return {
      action: "rollover",
      target: distributor,
      due: false,
      wouldSucceed: false,
      sent: false,
      reason: `epoch ${epochId} is still claimable for another ${expiresAt - block.timestamp} seconds. Rolling it over early would take funds from people who can still claim them.`,
    };
  }

  const unclaimed0 = epoch[EPOCH_FIELD.amount0] - epoch[EPOCH_FIELD.claimed0];
  const unclaimed1 = epoch[EPOCH_FIELD.amount1] - epoch[EPOCH_FIELD.claimed1];
  if (unclaimed0 === 0n && unclaimed1 === 0n) {
    return {
      action: "rollover",
      target: distributor,
      due: false,
      wouldSucceed: false,
      sent: false,
      reason: `epoch ${epochId} expired but was fully claimed; there is nothing to roll over.`,
    };
  }

  return simulateThenMaybeSend(ctx, "rollover", distributor, DISTRIBUTOR_ABI, "rollover", [epochId]);
}

async function settleBeneficiaries(
  ctx: LatchContext,
  hook: Address,
  poolId: Hex,
  currency: Address,
  poolKey: PoolKeyInput,
): Promise<Outcome> {
  // The check that matters. settleBeneficiaries does NOT revert when it is
  // pointless - it returns early on a zero pot or an empty roster - so a
  // simulation that "succeeds" by doing nothing is not a reason to send.
  const pending = (await ctx.publicClient.readContract({
    address: hook,
    abi: REV_SHARE_HOOK_ABI,
    functionName: "pendingBeneficiary",
    args: [poolId, currency],
  })) as bigint;

  if (pending === 0n) {
    return {
      action: "settleBeneficiaries",
      target: hook,
      due: false,
      wouldSucceed: true,
      sent: false,
      reason:
        "nothing pending for this pool and currency. The call would succeed but would do nothing, which is not a reason to spend gas.",
    };
  }

  return simulateThenMaybeSend(
    ctx,
    "settleBeneficiaries",
    hook,
    REV_SHARE_HOOK_ABI,
    "settleBeneficiaries",
    [poolKeyTuple(poolKey), currency],
  );
}

async function applyPendingConfig(
  ctx: LatchContext,
  hook: Address,
  poolId: Hex,
  poolKey: PoolKeyInput,
): Promise<Outcome> {
  const pending = (await ctx.publicClient.readContract({
    address: hook,
    abi: REV_SHARE_HOOK_ABI,
    functionName: "getPendingConfig",
    args: [poolId],
  })) as unknown;

  // (uint48 effectiveBlock, uint48 expiryBlock, ConfigParams params); viem returns a
  // nested tuple.
  const flat = Array.isArray(pending) && Array.isArray(pending[0]) ? pending[0] : pending;
  const effectiveBlock = BigInt(String((flat as readonly unknown[])[0] ?? 0));
  const expiryBlock = BigInt(String((flat as readonly unknown[])[1] ?? 0));

  if (effectiveBlock === 0n) {
    return {
      action: "applyPendingConfig",
      target: hook,
      due: false,
      wouldSucceed: false,
      sent: false,
      reason: "no config change is outstanding for this pool.",
    };
  }

  const blockNumber = await ctx.publicClient.getBlockNumber();
  if (blockNumber < effectiveBlock) {
    return {
      action: "applyPendingConfig",
      target: hook,
      due: false,
      wouldSucceed: false,
      sent: false,
      reason: `the pending config takes effect at block ${effectiveBlock}; ${effectiveBlock - blockNumber} block(s) to go.`,
    };
  }

  // A proposal has a WINDOW now, not a deadline: past `expiryBlock` it is dead and the
  // owner has to propose again and wait the full delay again. Reported as not-due rather
  // than left to a simulation, so a reader is told WHY nothing will happen.
  if (expiryBlock !== 0n && blockNumber > expiryBlock) {
    return {
      action: "applyPendingConfig",
      target: hook,
      due: false,
      wouldSucceed: false,
      sent: false,
      reason: `the pending config expired at block ${expiryBlock}; it can no longer be applied and the pool owner has to propose it again.`,
    };
  }

  return simulateThenMaybeSend(
    ctx,
    "applyPendingConfig",
    hook,
    REV_SHARE_HOOK_ABI,
    "applyPendingConfig",
    [poolKeyTuple(poolKey)],
  );
}
