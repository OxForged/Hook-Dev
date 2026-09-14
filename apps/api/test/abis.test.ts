import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Abi, AbiEvent } from "viem";
import { describe, expect, it } from "vitest";
import type { AbiFunction } from "viem";
import { BIN_LP_LOCKER_EVENTS_ABI, CL_LP_LOCKER_EVENTS_ABI, FEE_CONTROLLER_V2_EVENTS_ABI, KIT_V2_EVENTS_ABI, KIT_V2_FUNCTIONS_ABI, LAUNCH_REGISTRY_EVENTS_ABI, REVSHARE_EVENTS_ABI, TIMELOCK_EVENTS_ABI } from "../src/chain/abis.js";

/**
 * The ABIs in src/chain/abis.ts are hand-declared because the SDK does not ship
 * them. This diffs each against the compiled Foundry artifact. Skipped (not
 * failed) where the artifact is not built, e.g. in the TypeScript CI job.
 */

const sig = (e: AbiEvent) => `${e.name}(${e.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""}`).join(",")})`;

function artifactEvents(rel: string): Map<string, string> | null {
  const path = fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
  if (!existsSync(path)) return null;
  const abi = (JSON.parse(readFileSync(path, "utf8")) as { abi: Abi }).abi;
  return new Map(abi.filter((x): x is AbiEvent => x.type === "event").map((e) => [e.name, sig(e)]));
}

const cases: [string, string, Abi][] = [
  ["RevShareHook", "packages/hooks-revshare/foundry-out/RevShareHook.sol/RevShareHook.json", REVSHARE_EVENTS_ABI as unknown as Abi],
  ["LatchProtocolFeeControllerV2", "packages/fees/foundry-out/LatchProtocolFeeControllerV2.sol/LatchProtocolFeeControllerV2.json", FEE_CONTROLLER_V2_EVENTS_ABI as unknown as Abi],
  ["LatchLaunchRegistry", "packages/registry/foundry-out/LatchLaunchRegistry.sol/LatchLaunchRegistry.json", LAUNCH_REGISTRY_EVENTS_ABI as unknown as Abi],
  // Vendored (the SDK ships no kit v2 or locker ABI). LegKind/Currency/PoolId compile to uint8/address/bytes32.
  ["LaunchpadKitV2", "packages/launchpad/foundry-out/LaunchpadKitV2.sol/LaunchpadKitV2.json", KIT_V2_EVENTS_ABI as unknown as Abi],
  ["LatchLPLocker", "packages/launchpad/foundry-out/LatchLPLocker.sol/LatchLPLocker.json", CL_LP_LOCKER_EVENTS_ABI as unknown as Abi],
  ["LatchBinLPLocker", "packages/launchpad/foundry-out/LatchBinLPLocker.sol/LatchBinLPLocker.json", BIN_LP_LOCKER_EVENTS_ABI as unknown as Abi],
];

const fsig = (f: AbiFunction) => `${f.name}(${f.inputs.map((i) => i.type).join(",")})->(${f.outputs.map((o) => o.type).join(",")}) ${f.stateMutability}`;

describe("hand-declared event ABIs match the compiled contracts", () => {
  for (const [name, rel, declared] of cases) {
    const compiled = artifactEvents(rel);
    it.skipIf(compiled === null)(`${name}`, () => {
      for (const e of declared.filter((x): x is AbiEvent => x.type === "event")) {
        expect(compiled!.get(e.name), `${name}.${e.name}`).toBe(sig(e));
      }
    });
  }

  const kitPath = fileURLToPath(new URL("../../../packages/launchpad/foundry-out/LaunchpadKitV2.sol/LaunchpadKitV2.json", import.meta.url));
  it.skipIf(!existsSync(kitPath))("LaunchpadKitV2 functions the admin panel reads and prepares", () => {
    const compiled = new Map((JSON.parse(readFileSync(kitPath, "utf8")) as { abi: Abi }).abi.filter((x): x is AbiFunction => x.type === "function").map((f) => [f.name, fsig(f)]));
    for (const f of (KIT_V2_FUNCTIONS_ABI as unknown as Abi).filter((x): x is AbiFunction => x.type === "function")) {
      expect(compiled.get(f.name), `LaunchpadKitV2.${f.name}`).toBe(fsig(f));
    }
  });

  it("OpenZeppelin TimelockController event shapes", () => {
    const names = (TIMELOCK_EVENTS_ABI as unknown as AbiEvent[]).map(sig);
    expect(names).toContain("CallScheduled(bytes32 indexed,uint256 indexed,address,uint256,bytes,bytes32,uint256)");
    expect(names).toContain("CallExecuted(bytes32 indexed,uint256 indexed,address,uint256,bytes)");
    expect(names).toContain("Cancelled(bytes32 indexed)");
  });
});
