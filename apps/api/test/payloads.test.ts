import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LATCH_DEPLOYMENTS } from "@latchprotocol/sdk";
import { toFunctionSelector, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { computeAlerts, queuedAcceptOwnership, type AlertInputs } from "../src/admin/alerts.js";
import { csvCell, toCsv } from "../src/admin/csv.js";
import * as safeTx from "../src/admin/safeTx.js";
import { describeRevert } from "../src/admin/simulate.js";
import { groupTimelockOperations, type TimelockEventRow } from "../src/admin/timelockOps.js";
import { gasThresholds, parseChainConfig } from "../src/config/chainConfig.js";
import { ownershipChecks } from "../src/indexer/governance.js";

const {
  RECORDED_ACCEPT_OWNERSHIP_OPERATIONS: REC,
  hashOperation,
  prepareExecuteOperation,
  prepareCollectProtocolFees,
  prepareSweep,
  prepareRegistryListing,
  safeAppUrl,
} = safeTx;

const d = LATCH_DEPLOYMENTS[4663];
const SAFE = d.governanceSafe;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;

/* ---------------------------------------------------------------------------
   Golden values. The ids and salts are the ones CLAUDE.md "VERIFIED LIVE STATE"
   records for the three operations queued at block 61,325,176; the execute()
   calldata was encoded independently and every selector matches
   methodIdentifiers in the Foundry artifacts (LatchTimelock, V2 controller,
   LatchRegistry).
   --------------------------------------------------------------------------- */

const GOLDEN_EXECUTE: Record<string, string> = {
  "0xb04e05ca3f8018246e91f8c15d2d3e4f2108afb9b44b3961e90573f026d5f33d":
    "0x134008d300000000000000000000000078e8359c6d34df797b8a793de8c7c6bffa97fb6c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000e17bfec589d6a2594c2d59f7a1455e637425f2d5a4cbbcdf9062e39fad16e555000000000000000000000000000000000000000000000000000000000000000479ba509700000000000000000000000000000000000000000000000000000000",
  "0xab9c8f8e5fc6f02fafbc903847adccebca65b5811f5489993d9c0033721ebf00":
    "0x134008d30000000000000000000000005d7111d6c624e9a08ae63d342e4bae5878989a67000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000b0ecc7113374d7c91a718f0d7a67a59bbf2efaaaf0f6c3a209b541cb4e3de097000000000000000000000000000000000000000000000000000000000000000479ba509700000000000000000000000000000000000000000000000000000000",
  "0x700f7b00af4f2d2109587a37f6dc3b12477e074385fa1e23a72f482ea1be4f6e":
    "0x134008d300000000000000000000000098920e33313257ffd942f94379a7ced216462665000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000004787d44da9b61fa3107ab9bd0ef45f807be8debdaa46b66a2ae96ceb458a62c1000000000000000000000000000000000000000000000000000000000000000479ba509700000000000000000000000000000000000000000000000000000000",
};

describe("queued custody handover: execute() payloads (golden)", () => {
  it("the recorded targets are the SDK's Vault and owner wrappers on the custody timelock", () => {
    expect(REC.timelock).toBe(d.timelockCustody);
    expect(REC.operations.map((o) => o.target)).toEqual([d.vault, d.clPoolManagerOwner, d.binPoolManagerOwner]);
    expect(new Date(REC.readyAtUnix * 1000).toISOString()).toBe("2026-09-14T18:40:43.000Z");
  });

  for (const op of REC.operations) {
    it(`${op.contract}: hashOperation(target, 0, acceptOwnership(), 0x0, salt) == ${op.id.slice(0, 10)}… and execute() calldata is exact`, () => {
      expect(hashOperation(op.target, 0n, "0x79ba5097", ZERO32, op.salt)).toBe(op.id);
      const p = prepareExecuteOperation({ chainId: 4663, timelock: REC.timelock, safe: SAFE, from: "0x0000000000000000000000000000000000000001", operationId: op.id, target: op.target, value: 0n, data: "0x79ba5097", predecessor: ZERO32, salt: op.salt, saltSource: "indexed CallSalt event", description: "t" });
      expect(p.direct.data).toBe(GOLDEN_EXECUTE[op.id]);
      expect(p.safeTx.data).toBe(GOLDEN_EXECUTE[op.id]);
      expect(p.direct.to).toBe(REC.timelock);
      expect(p.safeTx.operation).toBe(0);
      expect(p.direct.decoded?.functionName).toBe("execute");
      expect(p.recomputedId).toBe(op.id);
    });
  }

  it("refuses to build execute() when the arguments do not hash to the operation id", () => {
    const op = REC.operations[0];
    expect(() => prepareExecuteOperation({ chainId: 4663, timelock: REC.timelock, safe: SAFE, from: SAFE, operationId: op.id, target: op.target, value: 0n, data: "0x79ba5097", predecessor: ZERO32, salt: REC.operations[1].salt, saltSource: "indexed CallSalt event", description: "t" })).toThrow(/hash/);
  });

  it("there is no schedule builder: the batch with salt 0xfdd6…ae74 was never sent and would duplicate the queued operations", () => {
    const exported = Object.keys(safeTx);
    expect(exported.filter((k) => /schedule|batch/i.test(k))).toEqual([]);
    const src = readFileSync(fileURLToPath(new URL("../src/admin/safeTx.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/functionName:\s*"schedule/);
  });

  it("selectors match the compiled contracts' methodIdentifiers", () => {
    expect(toFunctionSelector("function execute(address,uint256,bytes,bytes32,bytes32)")).toBe("0x134008d3");
    expect(toFunctionSelector("function isOperationReady(bytes32)")).toBe("0x13bc9f20");
    expect(toFunctionSelector("function collect(address,address,uint256,address)")).toBe("0x3c49be0c");
    expect(toFunctionSelector("function sweep(address,address)")).toBe("0xb8dc491b");
    expect(toFunctionSelector("function setListing(address,uint8,string)")).toBe("0xefd3b1e5");
  });
});

describe("fee controller and registry payloads (golden)", () => {
  it("collect(clPoolManager, LTT1, 0, Safe)", () => {
    const p = prepareCollectProtocolFees({ chainId: 4663, safe: SAFE, feeController: d.feeController, poolManager: d.clPoolManager, currency: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6", amount: 0n, recipient: SAFE });
    expect(p.data).toBe("0x3c49be0c000000000000000000000000f4a28fa4cfecaef349a7d52fa1eb4df56eb22f660000000000000000000000002a21c0826848f2d597b7c87a4b931de1407958a60000000000000000000000000000000000000000000000000000000000000000000000000000000000000000715a6176946adbd22c1b2021d321fb3767ca3432");
    expect(p.to).toBe(d.feeController);
    expect(p.operation).toBe(0);
    expect("nonce" in p).toBe(false);
    expect(p.decoded?.args.map((a) => a.name)).toEqual(["poolManager", "currency", "amount", "recipient"]);
  });

  it("sweep(clPoolManager, LTT1)", () => {
    const p = prepareSweep({ chainId: 4663, safe: SAFE, feeController: d.feeController, poolManager: d.clPoolManager, currency: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6" });
    expect(p.data).toBe("0xb8dc491b000000000000000000000000f4a28fa4cfecaef349a7d52fa1eb4df56eb22f660000000000000000000000002a21c0826848f2d597b7c87a4b931de1407958a6");
  });

  it("registry flag is a DIRECT call (not a Safe tx) to setListing(hook, Malicious, reason)", () => {
    const p = prepareRegistryListing({ chainId: 4663, registry: d.registry, from: "0x304b0cc019CDBA6C7c767D86a2A34e69FDb3c9a9", hook: "0x1111111111111111111111111111111111111111", action: "flag", reason: "drains swaps via hookDelta" });
    expect(p.kind).toBe("direct");
    expect(p.to).toBe(d.registry);
    expect(p.data).toBe("0xefd3b1e5000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001a647261696e732073776170732076696120686f6f6b44656c7461000000000000");
    const unflag = prepareRegistryListing({ chainId: 4663, registry: d.registry, from: SAFE, hook: "0x1111111111111111111111111111111111111111", action: "unflag", reason: "false positive, verified" });
    expect(unflag.decoded?.args[1]?.value).toBe("0");
    expect(() => prepareRegistryListing({ chainId: 4663, registry: d.registry, from: SAFE, hook: "0x1111111111111111111111111111111111111111", action: "flag", reason: "x".repeat(513) })).toThrow(/MAX_NOTE_BYTES/);
  });

  it("the Safe app link opens the Safe, with the chain short name from ops/safe/README.md", () => {
    expect(safeAppUrl("robinhood", SAFE)).toBe("https://app.safe.global/home?safe=robinhood:0x715a6176946aDbD22c1B2021d321Fb3767ca3432");
  });

  it("decodes a known revert for the simulation result", () => {
    // OwnableUnauthorizedAccount(0x...01)
    const raw = `0x118cdaa7${"0".repeat(63)}1` as Hex;
    expect(describeRevert(raw, "reverted")?.name).toBe("OwnableUnauthorizedAccount");
  });
});

/* ---------------------------------------------------------------------------
   Alerts against the recorded live state
   --------------------------------------------------------------------------- */

const CUSTODY = d.timelockCustody.toLowerCase();
const now = new Date("2026-09-15T00:00:00Z");
const scheduledAt = "2026-09-12T18:40:43.000Z";

function tlRows(extra: TimelockEventRow[] = []): TimelockEventRow[] {
  return [
    ...REC.operations.flatMap((o, i): TimelockEventRow[] => [
      { chainId: 4663, timelock: CUSTODY, tier: "custody", eventName: "CallScheduled", operationId: o.id, callIndex: 0, target: o.target.toLowerCase(), value: "0", data: "0x79ba5097", selector: "0x79ba5097", functionSignature: "function acceptOwnership()", predecessor: ZERO32, salt: null, delaySeconds: "172800", hazard: null, hazardNote: null, blockNumber: "61325176", blockTimestamp: scheduledAt, txHash: `0x${"ab".repeat(32)}`, logIndex: i * 2 },
      { chainId: 4663, timelock: CUSTODY, tier: "custody", eventName: "CallSalt", operationId: o.id, callIndex: null, target: null, value: null, data: null, selector: null, functionSignature: null, predecessor: null, salt: o.salt, delaySeconds: null, hazard: null, hazardNote: null, blockNumber: "61325176", blockTimestamp: scheduledAt, txHash: `0x${"ab".repeat(32)}`, logIndex: i * 2 + 1 },
    ]),
    ...extra,
  ];
}

function inputs(ownerOf: (key: string) => string, over: Partial<AlertInputs> = {}): AlertInputs {
  const row = (contractKey: string, address: string, check: "owner" | "pendingOwner", observed: string, expectedAddress: string) => ({ chainId: 4663, contractKey, address: address.toLowerCase(), check, observed, expectedTier: check === "owner" ? "Custody (48h timelock)" : "none pending", expectedAddress, matches: observed === expectedAddress, readError: null, readAtBlock: "62600000", readAt: now.toISOString() });
  const zero = `0x${"0".repeat(40)}`;
  const targets: [string, string][] = [["vault", d.vault], ["clPoolManagerOwner", d.clPoolManagerOwner!], ["binPoolManagerOwner", d.binPoolManagerOwner!]];
  const ownership = targets.flatMap(([k, a]) => {
    const o = ownerOf(k);
    return [row(k, a, "owner", o, CUSTODY), row(k, a, "pendingOwner", o === CUSTODY ? zero : CUSTODY, zero)];
  });
  return {
    now,
    chains: [],
    governance: [{ chainId: 4663, safe: d.governanceSafe, timelockCustody: d.timelockCustody, timelockPolicy: d.timelockPolicy }],
    ownership,
    pendingConfigs: [],
    opsBalances: [],
    feeds: [],
    stockTokens: [],
    timelockOps: groupTimelockOperations(tlRows(), now).operations,
    reconciliationMismatches: [],
    pendingListings: 0,
    ...over,
  };
}

describe("alerts: the recorded live state", () => {
  it("the unaccepted custody handover is HIGH on all three contracts and names the READY operation", () => {
    const alerts = computeAlerts(inputs(() => SAFE.toLowerCase()));
    const handover = alerts.filter((a) => a.id.endsWith("custody-handover-unaccepted"));
    expect(handover.map((a) => a.severity)).toEqual(["HIGH", "HIGH", "HIGH"]);
    const vault = handover.find((a) => a.id.includes(":vault:"))!;
    expect(vault.detail).toContain(REC.operations[0].id);
    expect(vault.detail).toContain("READY");
    expect(vault.action?.page).toBe("safe-actions");
  });

  it("stays HIGH after execute() until owner() reads the timelock, then clears automatically", () => {
    const executed = groupTimelockOperations(tlRows([{ chainId: 4663, timelock: CUSTODY, tier: "custody", eventName: "CallExecuted", operationId: REC.operations[0].id, callIndex: 0, target: null, value: null, data: null, selector: null, functionSignature: null, predecessor: null, salt: null, delaySeconds: null, hazard: null, hazardNote: null, blockNumber: "62700000", blockTimestamp: now.toISOString(), txHash: `0x${"ee".repeat(32)}`, logIndex: 0 }]), now).operations;
    const stillSafe = computeAlerts(inputs(() => SAFE.toLowerCase(), { timelockOps: executed })).find((a) => a.id === "own:4663:vault:custody-handover-unaccepted")!;
    expect(stillSafe.severity).toBe("HIGH");
    expect(stillSafe.detail).toContain("executed");
    const accepted = computeAlerts(inputs((k) => (k === "vault" ? CUSTODY : SAFE.toLowerCase()), { timelockOps: executed }));
    expect(accepted.some((a) => a.id.startsWith("own:4663:vault:"))).toBe(false);
    expect(accepted.filter((a) => a.id.endsWith("custody-handover-unaccepted"))).toHaveLength(2);
  });

  it("before the delay the operation is PENDING with a ready time; a cancelled one has none", () => {
    const early = groupTimelockOperations(tlRows(), new Date("2026-09-13T00:00:00Z")).operations;
    expect(early.every((o) => o.status === "PENDING")).toBe(true);
    expect(early[0]!.readyAt).toBe("2026-09-14T18:40:43.000Z");
    expect(early.find((o) => o.operationId === REC.operations[1].id)!.salt).toBe(REC.operations[1].salt);

    const cancelled = groupTimelockOperations(tlRows([{ chainId: 4663, timelock: CUSTODY, tier: "custody", eventName: "Cancelled", operationId: REC.operations[2].id, callIndex: null, target: null, value: null, data: null, selector: null, functionSignature: null, predecessor: null, salt: null, delaySeconds: null, hazard: null, hazardNote: null, blockNumber: "62000000", blockTimestamp: now.toISOString(), txHash: `0x${"cc".repeat(32)}`, logIndex: 0 }]), now).operations;
    const c = cancelled.find((o) => o.operationId === REC.operations[2].id)!;
    expect(c.status).toBe("CANCELLED");
    expect(c.readyAt).toBeNull();
    // A cancelled accept is not "the fix": the handover alert says none is queued.
    expect(queuedAcceptOwnership(cancelled, CUSTODY, d.binPoolManagerOwner!)).toBeNull();
  });

  it("the canceller at 1,183,834,050,000 wei is CRITICAL at the observed 78,334,000 wei gas price", () => {
    const cfg = parseChainConfig(JSON.parse(readFileSync(fileURLToPath(new URL("../config/chains/4663.json", import.meta.url)), "utf8")), 4663);
    const canceller = cfg.opsAccounts.find((a) => a.role === "canceller")!;
    expect(canceller.gasBudget!.rationale.length).toBeGreaterThan(200);
    const t = gasThresholds(1_183_834_050_000n, canceller.gasBudget!, 78_334_000n);
    expect(t.severity).toBe("CRITICAL");
    expect(t.actionsAffordable).toBe(0n);
    const alerts = computeAlerts(inputs(() => CUSTODY, { opsBalances: [{ chainId: 4663, label: "canceller", address: canceller.address, balanceWei: "1183834050000", criticalWei: t.criticalWei.toString(), minWei: t.warnWei.toString(), severity: t.severity, actionsAffordable: "0", gasPriceWei: "78334000", readAt: now.toISOString(), readAtBlock: "1" }] }));
    expect(alerts[0]!.severity).toBe("CRITICAL");
    expect(alerts[0]!.id).toBe("ops:4663:canceller");
  });

  it("a threshold without a real rationale is refused at config load", () => {
    expect(() => parseChainConfig({ chainId: 1, gas: { referenceGasPriceWei: "1", referenceSource: "x" }, opsAccounts: [{ label: "a", address: SAFE, purpose: "p", gasBudget: { action: "a", gasUnits: "1", criticalActions: 1, warnActions: 2, rationale: "tbd" } }] }, 1)).toThrow();
  });

  it("a queued do-not-queue call is CRITICAL", () => {
    const hz: TimelockEventRow = { chainId: 4663, timelock: CUSTODY, tier: "custody", eventName: "CallScheduled", operationId: `0x${"99".repeat(32)}`, callIndex: 0, target: CUSTODY, value: "0", data: `0x64d62353${"0".repeat(64)}`, selector: "0x64d62353", functionSignature: "function updateDelay(uint256)", predecessor: ZERO32, salt: null, delaySeconds: "172800", hazard: "updateDelay", hazardNote: "Timelock delay change.", blockNumber: "62000000", blockTimestamp: now.toISOString(), txHash: `0x${"99".repeat(32)}`, logIndex: 0 };
    const alerts = computeAlerts(inputs(() => CUSTODY, { timelockOps: groupTimelockOperations([hz], now).operations }));
    expect(alerts.find((a) => a.id.startsWith("tl:"))!.severity).toBe("CRITICAL");
  });

  it("pendingOwner is checked on the owner wrappers, not on the pool managers; CANCELLER_ROLE on both timelocks", () => {
    const checks = ownershipChecks(d, "0xe65f304e40b61d7417154cb3e725c0ee16701142", { ops: "0x304b0cc019cdba6c7c767d86a2a34e69fdb3c9a9" });
    expect(checks.some((c) => c.contractKey === "clPoolManagerOwner" && c.check === "pendingOwner")).toBe(true);
    expect(checks.some((c) => c.contractKey === "clPoolManager" && c.check === "pendingOwner")).toBe(false);
    expect(checks.some((c) => c.contractKey === "binPoolManager" && c.check === "pendingOwner")).toBe(false);
    for (const tl of ["timelockCustody", "timelockPolicy"]) {
      expect(checks.some((c) => c.contractKey === tl && c.check.startsWith("hasRole:CANCELLER_ROLE:"))).toBe(true);
    }
    expect(checks.some((c) => c.check === "treasury")).toBe(true);
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formulas but keeps our integers numeric", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-1000")).toBe("-1000");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(toCsv(["a", "b"], [[1n, null]])).toBe("a,b\r\n1,\r\n");
  });
});

describe("the API holds no key and has no send path", () => {
  const FORBIDDEN = /privateKeyToAccount|mnemonicToAccount|hdKeyToAccount|createWalletClient|signTransaction|sendTransaction|sendRawTransaction|eth_sendTransaction|eth_sendRawTransaction|eth_signTypedData|personal_sign|writeContract|\.signMessage\(|PRIVATE_KEY|MNEMONIC|safe-transaction-service|proposeTransaction/;
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

  it("no file under src/ references a signer, a wallet client or a send method", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const offenders = walk(src)
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, i: i + 1, line })))
      .filter(({ line }) => FORBIDDEN.test(line) && !/^\s*(\*|\/\/)/.test(line));
    expect(offenders).toEqual([]);
  });

  it("the env contract has no key variable", () => {
    const env = readFileSync(fileURLToPath(new URL("../src/config/env.ts", import.meta.url)), "utf8");
    expect(env).not.toMatch(/PRIVATE|MNEMONIC|SIGNER|WALLET/);
  });
});
