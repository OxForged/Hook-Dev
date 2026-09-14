// SPDX-License-Identifier: MIT
// Every transaction the campaign sends goes through `send`, which (1) simulates to capture revert
// data, (2) MINES the transaction on the fork either way so there is a real fork tx hash and
// receipt, (3) decodes the outcome and (4) compares it with the declared expectation.
import fs from "node:fs";
import path from "node:path";
import { encodeFunctionData, encodeDeployData, getAddress } from "viem";
import { decodeRevert, decodeLogs, jsonSafe } from "./abis.mjs";

export function createRecorder(chain, outFile) {
  const results = {
    schema: "latch-fork-campaign/v1",
    generatedAt: new Date().toISOString(),
    meta: {},
    codeVerification: [],
    calls: [],
    scenarios: [],
    hazards: [],
    unexpected: [],
    notExercised: [],
    notes: [],
  };
  let seq = 0;
  let currentScenario = null;

  const rec = {
    results,
    chain,

    scenario(name, description) {
      currentScenario = { name, description, startedCallIndex: results.calls.length, asserts: [], outcome: null };
      results.scenarios.push(currentScenario);
      console.log(`\n=== ${name}`);
      return currentScenario;
    },

    /**
     * Send one transaction.
     * @param o.contract   logical contract name used for coverage ("Vault", "RevShareHook_fC00", ...)
     * @param o.fn         function name (overloads: pass `sig` too, it is recorded verbatim)
     * @param o.expect     "success" | "revert"
     * @param o.expectError  revert name that must appear in the decoded chain (innermost or outer)
     * @param o.role       "authorized" | "unauthorized" | "setup" | "hazard"
     */
    async send(o) {
      const { from, to, abi, fn, args = [], value = 0n, expect = "success", expectError, role = "authorized", contract, note, gas } = o;
      await chain.impersonate(from);
      const bal = await chain.balance(from);
      if (bal < 10n ** 19n) await chain.fund(from, 10n ** 21n);
      const data = o.data ?? encodeFunctionData({ abi, functionName: fn, args });
      return rec._sendRaw({ from, to, data, value, expect, expectError, role, contract, fn: o.sig ?? fn, note, gas, argsSummary: summarize(args) });
    },

    async deploy({ from, abi, bytecode, args = [], contract, note }) {
      await chain.impersonate(from);
      const data = encodeDeployData({ abi, bytecode, args });
      const r = await rec._sendRaw({ from, to: null, data, value: 0n, expect: "success", role: "setup", contract, fn: "(deploy)", note, argsSummary: summarize(args) });
      return r.contractAddress;
    },

    async _sendRaw({ from, to, data, value, expect, expectError, role, contract, fn, note, gas, argsSummary }) {
      const call = { from: getAddress(from), data, value: `0x${value.toString(16)}` };
      if (to) call.to = getAddress(to);
      let simError = null;
      let estimate = null;
      try {
        estimate = BigInt(await chain.rpc("eth_estimateGas", [call]));
      } catch (e) {
        simError = e.rpcError?.data ?? null;
        if (!simError && e.rpcError) simError = { message: e.rpcError.message };
      }
      // Floor of 3M: functions that swallow inner reverts (initializePool, Permit2 forwarders) estimate
      // too low, and the 63/64 rule then starves the inner call. gasUsed, not the limit, is recorded.
      const txGas = gas ?? (estimate ? maxBig((estimate * 13n) / 10n + 50_000n, 3_000_000n) : 8_000_000n);
      const hash = await chain.rpc("eth_sendTransaction", [{ ...call, gas: `0x${txGas.toString(16)}` }]);
      const receipt = await waitReceipt(chain, hash);
      const status = receipt.status === "0x1" ? "success" : "revert";
      let error = null;
      if (status === "revert") {
        const revertData = typeof simError === "string" ? simError : await replayRevert(chain, receipt, call);
        error = typeof revertData === "string" ? decodeRevert(revertData) : { name: "(no data)", text: JSON.stringify(simError) };
      }
      let ok = status === expect;
      if (ok && expect === "revert" && expectError) {
        ok = error.text.includes(expectError);
      }
      const entry = {
        seq: ++seq,
        scenario: currentScenario?.name ?? null,
        contract,
        fn,
        role,
        from: getAddress(from),
        to: to ? getAddress(to) : null,
        args: argsSummary,
        value: value.toString(),
        txHash: hash,
        block: Number(BigInt(receipt.blockNumber)),
        status,
        error: error?.text ?? null,
        errorName: error?.innermost ?? error?.name ?? null,
        gasUsed: Number(BigInt(receipt.gasUsed)),
        expect,
        expectError: expectError ?? null,
        pass: ok,
        note: note ?? null,
        events: status === "success" ? decodeLogs(receipt.logs).map((l) => l.event) : [],
        contractAddress: receipt.contractAddress ?? null,
      };
      results.calls.push(entry);
      const tag = ok ? "ok " : "!! ";
      console.log(`${tag}${contract}.${fn} [${role}] ${status}${error ? ` ${error.text.slice(0, 160)}` : ""} gas=${entry.gasUsed}`);
      if (!ok) {
        results.unexpected.push({ kind: "call", seq: entry.seq, contract, fn, expected: expect, expectError: expectError ?? null, got: status, error: entry.error, txHash: hash, note: note ?? null });
      }
      entry.receipt = receipt;
      Object.defineProperty(entry, "receipt", { enumerable: false });
      return entry;
    },

    /** Record a state assertion inside the current scenario. */
    assert(what, actual, expected, cmp = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()) {
      const ok = cmp(actual, expected);
      const a = { what, actual: jsonSafe(actual), expected: jsonSafe(expected), ok };
      currentScenario?.asserts.push(a);
      console.log(`${ok ? "   assert ok " : "   ASSERT FAIL "}${what}: actual=${JSON.stringify(a.actual)} expected=${JSON.stringify(a.expected)}`);
      if (!ok) results.unexpected.push({ kind: "assert", scenario: currentScenario?.name, what, actual: a.actual, expected: a.expected });
      return ok;
    },

    hazard(id, title, evidence, reproduced) {
      results.hazards.push({ id, title, reproduced, evidence: jsonSafe(evidence) });
      console.log(`   HAZARD ${id} ${reproduced ? "REPRODUCED" : "NOT reproduced"}: ${title}`);
    },

    note(text, data) {
      results.notes.push({ scenario: currentScenario?.name ?? null, text, data: jsonSafe(data ?? null) });
      console.log(`   note: ${text}`);
    },

    notExercised(contract, fn, why) {
      results.notExercised.push({ contract, fn, why });
    },

    flush() {
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
    },
  };
  return rec;
}

const maxBig = (a, b) => (a > b ? a : b);

async function waitReceipt(chain, hash) {
  for (let i = 0; i < 600; i++) {
    const r = await chain.rpc("eth_getTransactionReceipt", [hash]);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`no receipt for ${hash}`);
}

/** When estimateGas succeeded but the mined tx reverted (state moved), replay at the parent block. */
async function replayRevert(chain, receipt, call) {
  const parent = `0x${(BigInt(receipt.blockNumber) - 1n).toString(16)}`;
  try {
    await chain.rpc("eth_call", [call, parent]);
    return "0x";
  } catch (e) {
    return e.rpcError?.data ?? "0x";
  }
}

function summarize(args) {
  const s = JSON.stringify(jsonSafe(args));
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}
