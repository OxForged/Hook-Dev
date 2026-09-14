// SPDX-License-Identifier: MIT
// Artifact loading and a union error/event decoder across every contract the campaign touches.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeErrorResult, decodeEventLog, toFunctionSelector, toEventSelector, toFunctionSignature, parseAbi, keccak256, toHex } from "viem";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ARTIFACT_DIR = path.resolve(here, "..", "artifacts");

const cache = new Map();
export function artifact(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(ARTIFACT_DIR, `${name}.json`), "utf8")));
  return cache.get(name);
}

export const ARTIFACT_NAMES = [
  "Vault", "CLPoolManager", "BinPoolManager", "CLPoolManagerOwner", "BinPoolManagerOwner", "ProtocolFeeController",
  "Create3Factory", "LatchProtocolFeeControllerV2", "LatchTimelock", "LatchTimelock_policy", "LatchRegistry",
  "LatchLaunchRegistry", "UniversalRouter", "CLPositionManager", "BinPositionManager", "CLQuoter", "BinQuoter",
  "CLPositionDescriptorOffChain", "LaunchpadKit", "LaunchGuardHook", "RevShareHook_fC00", "RevShareHook_23CE",
  "helpers/CampaignToken", "helpers/VaultActor", "helpers/MockLaunchpad", "helpers/BitmapHook", "helpers/CampaignSubscriber",
];

// Third-party ABIs the artifacts do not carry (Permit2, ERC-20, the Robinhood Stock token, OZ errors).
export const EXTERNAL_ABI = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function lockdown((address token, address spender)[] approvals)",
  "function invalidateNonces(address token, address spender, uint48 newNonce)",
  "error AllowanceExpired(uint256 deadline)",
  "error InsufficientAllowance(uint256 amount)",
  "error ExcessiveInvalidation()",
  "error InvalidNonce()",
  "error InvalidSigner()",
  "error SignatureExpired(uint256 signatureDeadline)",
  "error TransferFailed()",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error EnforcedPause()",
  "error ExpectedPause()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnableInvalidOwner(address owner)",
  "error TimelockUnauthorizedCaller(address caller)",
  "error TimelockInsufficientDelay(uint256 delay, uint256 minDelay)",
  "error TimelockUnexpectedOperationState(bytes32 operationId, bytes32 expectedStates)",
  "error TimelockUnexecutedPredecessor(bytes32 predecessorId)",
  "error TimelockInvalidOperationLength(uint256 targets, uint256 payloads, uint256 values)",
  "error FailedCall()",
  "error IsPaused()",
  "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
  "error AccessControlBadConfirmation()",
  "error ReentrancyGuardReentrantCall()",
  "error SafeERC20FailedOperation(address token)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
]);

function canonicalType(p) {
  if (p.type.startsWith("tuple")) return `(${p.components.map(canonicalType).join(",")})${p.type.slice(5)}`;
  return p.type;
}

let unionErrors;
let unionEvents;
function buildUnion() {
  const errs = new Map();
  const evs = new Map();
  const add = (item) => {
    if (item.type === "error") {
      const sel = keccak256(toHex(`${item.name}(${item.inputs.map(canonicalType).join(",")})`)).slice(0, 10);
      if (!errs.has(sel)) errs.set(sel, item);
    } else if (item.type === "event") {
      const sel = `${toEventSelector(item)}:${item.inputs.filter((i) => i.indexed).length}`;
      if (!evs.has(sel)) evs.set(sel, item);
    }
  };
  for (const n of ARTIFACT_NAMES) for (const item of artifact(n).abi) add(item);
  for (const item of EXTERNAL_ABI) add(item);
  unionErrors = [...errs.values()];
  unionEvents = [...evs.values()];
}

/** Decode revert data into `Name(arg, ...)`, recursing into any `bytes` argument that itself decodes. */
export function decodeRevert(data, depth = 0) {
  if (!unionErrors) buildUnion();
  if (!data || data === "0x") return { name: "(empty revert data)", text: "(empty revert data)" };
  try {
    const d = decodeErrorResult({ abi: unionErrors, data });
    const args = (d.args ?? []).map((a) => {
      if (typeof a === "string" && /^0x[0-9a-fA-F]{8,}$/.test(a) && a.length >= 10 && depth < 4) {
        const inner = decodeRevert(a, depth + 1);
        if (!inner.name.startsWith("(unknown")) return `<${inner.text}>`;
      }
      return typeof a === "bigint" ? a.toString() : Array.isArray(a) ? JSON.stringify(a, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : String(a);
    });
    const text = `${d.errorName}(${args.join(", ")})`;
    return { name: d.errorName, text, innermost: innermostName(text) };
  } catch {
    return { name: `(unknown selector ${data.slice(0, 10)})`, text: `(unknown selector ${data.slice(0, 10)}) ${data.slice(0, 138)}` };
  }
}

function innermostName(text) {
  const m = [...text.matchAll(/<([A-Za-z0-9_]+)\(/g)];
  return m.length ? m[m.length - 1][1] : text.split("(")[0];
}

/** Best-effort log decoding against the union; unknown logs are summarised by topic0. */
export function decodeLogs(logs) {
  if (!unionEvents) buildUnion();
  return logs.map((log) => {
    try {
      const d = decodeEventLog({ abi: unionEvents, data: log.data, topics: log.topics, strict: false });
      return { address: log.address, event: d.eventName, args: jsonSafe(d.args) };
    } catch {
      return { address: log.address, event: `(unknown ${log.topics?.[0]?.slice(0, 10)})` };
    }
  });
}

export function jsonSafe(v) {
  return JSON.parse(JSON.stringify(v ?? null, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

export function writeFunctions(abi) {
  return abi.filter((x) => x.type === "function" && x.stateMutability !== "view" && x.stateMutability !== "pure");
}
export function viewFunctions(abi) {
  return abi.filter((x) => x.type === "function" && (x.stateMutability === "view" || x.stateMutability === "pure"));
}
export function sigOf(item) {
  return toFunctionSignature(item);
}
