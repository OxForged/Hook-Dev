import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Abi, AbiEvent } from "viem";
import { describe, expect, it } from "vitest";
import { FEE_CONTROLLER_V2_EVENTS_ABI, LAUNCH_REGISTRY_EVENTS_ABI, REVSHARE_EVENTS_ABI, TIMELOCK_EVENTS_ABI } from "../src/chain/abis.js";

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
];

describe("hand-declared event ABIs match the compiled contracts", () => {
  for (const [name, rel, declared] of cases) {
    const compiled = artifactEvents(rel);
    it.skipIf(compiled === null)(`${name}`, () => {
      for (const e of declared.filter((x): x is AbiEvent => x.type === "event")) {
        expect(compiled!.get(e.name), `${name}.${e.name}`).toBe(sig(e));
      }
    });
  }

  it("OpenZeppelin TimelockController event shapes", () => {
    const names = (TIMELOCK_EVENTS_ABI as unknown as AbiEvent[]).map(sig);
    expect(names).toContain("CallScheduled(bytes32 indexed,uint256 indexed,address,uint256,bytes,bytes32,uint256)");
    expect(names).toContain("CallExecuted(bytes32 indexed,uint256 indexed,address,uint256,bytes)");
    expect(names).toContain("Cancelled(bytes32 indexed)");
  });
});
