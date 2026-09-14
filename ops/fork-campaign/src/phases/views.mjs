// SPDX-License-Identifier: MIT
// One eth_call per view/pure function on every deployed contract. Arguments are chosen from the
// parameter name and type against fixtures that exist at the setup snapshot; a revert is recorded,
// not treated as a failure (e.g. getLatch on an unregistered hook is SUPPOSED to revert).
import { encodeFunctionData, decodeFunctionResult } from "viem";
import { artifact, viewFunctions, sigOf, decodeRevert, jsonSafe } from "../abis.mjs";
import { ADDR, DEPLOYED } from "../addresses.mjs";
import { ACTORS } from "../lib.mjs";

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  rec.scenario("views", "one call per view/pure function");
  const head = await chain.evmClock();
  const pick = (contract, p) => {
    const n = (p.name ?? "").toLowerCase();
    const t = p.type;
    if (t === "tuple" && p.components?.some((c) => c.name === "currency0")) return state.baseCL.key;
    if (t.endsWith("[]")) return [];
    if (t === "tuple") return Object.fromEntries(p.components.map((c) => [c.name, pick(contract, c)]));
    if (t === "address") {
      if (n.includes("hook")) return contract.startsWith("RevShareHook_23CE") ? ADDR.revShareHookRetired : ADDR.revShareHookCurrent;
      if (n.includes("manager")) return ADDR.clPoolManager;
      if (n.includes("currency") || n.includes("token")) return state.tokens.TKA;
      if (n.includes("spender")) return ADDR.universalRouter;
      if (n.includes("launchpad")) return ADDR.launchpadKit;
      return ACTORS.alice;
    }
    if (t === "bytes32") {
      if (n.includes("role")) return "0x0000000000000000000000000000000000000000000000000000000000000000";
      if (contract.startsWith("RevShareHook_23CE")) return ADDR.demoPoolId;
      return state.baseCL.id;
    }
    if (t === "bytes4") return "0x01ffc9a7";
    if (t === "bool") return true;
    if (t === "string") return "";
    if (/^bytes\d+$/.test(t)) return `0x${"00".repeat(Number(t.slice(5)))}`;
    if (t.startsWith("bytes")) return "0x";
    if (t.startsWith("uint") || t.startsWith("int")) {
      if (n.includes("block")) return head.number;
      if (n.includes("limit")) return 5n;
      if (n.includes("fee")) return t === "uint24" ? 3000 : 3000n;
      if (n.includes("permission") || n === "p") return 0x41;
      if (n.includes("tokenid")) return 1n;
      if (n.includes("id") && contract.startsWith("Bin")) return 8388608;
      const bits = Number(t.replace(/u?int/, "")) || 256;
      return bits <= 48 ? 0 : 0n;
    }
    return 0n;
  };
  const rows = [];
  for (const [name, address, art] of DEPLOYED) {
    const abi = artifact(art).abi;
    for (const fn of viewFunctions(abi)) {
      let args;
      try {
        args = fn.inputs.map((p) => pick(name, p));
        const data = encodeFunctionData({ abi: [fn], functionName: fn.name, args });
        const out = await chain.rpc("eth_call", [{ to: address, data }, "latest"]);
        const val = decodeFunctionResult({ abi: [fn], functionName: fn.name, data: out, args });
        rows.push({ contract: name, fn: sigOf(fn), ok: true, result: JSON.stringify(jsonSafe(val)).slice(0, 200) });
      } catch (e) {
        const reason = e.rpcError?.data ? decodeRevert(e.rpcError.data).text : (e.shortMessage ?? e.message).slice(0, 160);
        rows.push({ contract: name, fn: sigOf(fn), ok: false, revert: reason, args: JSON.stringify(jsonSafe(args ?? [])).slice(0, 200) });
      }
    }
  }
  rec.results.views = rows;
  rec.note(`view calls: ${rows.length}, answered ${rows.filter((r) => r.ok).length}, reverted ${rows.filter((r) => !r.ok).length}`);
}
