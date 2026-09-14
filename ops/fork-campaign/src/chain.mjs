// SPDX-License-Identifier: MIT
// viem clients over the GUARDED raw rpc, plus anvil cheat helpers. Every request goes through
// `guard.mjs`; there is no other way to construct a client in this harness.
import { createPublicClient, custom, encodeFunctionData, decodeFunctionResult, getAddress } from "viem";
import { guardedRpc } from "./guard.mjs";

/** Anvil's well-known dev accounts (public keys of the public "test test ... junk" mnemonic). */
export const ANVIL_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
];
/** Account 0's key. Publicly known; valid ONLY because every request is guarded to a local fork. */
export const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export async function connect(url) {
  const { rpc, identity } = await guardedRpc(url);
  const transport = custom({ request: ({ method, params }) => rpc(method, params ?? []) });
  const client = createPublicClient({ transport });
  const impersonated = new Set(ANVIL_ACCOUNTS.map((a) => a.toLowerCase()));

  const chain = {
    rpc,
    client,
    identity,
    async impersonate(address) {
      const a = address.toLowerCase();
      if (impersonated.has(a)) return;
      await rpc("anvil_impersonateAccount", [getAddress(address)]);
      impersonated.add(a);
    },
    async fund(address, wei = 10n ** 21n) {
      await rpc("anvil_setBalance", [getAddress(address), `0x${wei.toString(16)}`]);
    },
    /** The forked Nitro header carries no excessBlobGas, so anvil refuses eth_call against it
     *  ("Excess blob gas not set"). Mining one local block gives anvil a header of its own. */
    async prime() {
      const h = await rpc("eth_getBlockByNumber", ["latest", false]);
      if (h.excessBlobGas === undefined || h.excessBlobGas === null) await rpc("evm_mine");
      await chain.neutralizeDevAccounts();
    },
    /** Anvil's public dev accounts carry EIP-7702 delegation code on Robinhood mainnet (measured
     *  2026-09-14: all ten delegate to 0x8a5b10eb…, the pattern of a key-sweeper). With that code
     *  present, ERC-721/Permit2 signature checks take the ERC-1271 path and safeTransferFrom calls
     *  a receiver hook, so every "EOA" test would really be a smart-account test. Cleared on the
     *  FORK only; returns what was found so the run records it. */
    async neutralizeDevAccounts() {
      const found = [];
      for (const a of ANVIL_ACCOUNTS) {
        const code = await rpc("eth_getCode", [a, "latest"]);
        if (code && code !== "0x") {
          found.push({ account: a, code: code.slice(0, 48) });
          await rpc("anvil_setCode", [a, "0x"]);
        }
      }
      chain.devAccountCodeCleared = found;
      return found;
    },
    async snapshot() {
      return rpc("evm_snapshot");
    },
    async revert(id) {
      const ok = await rpc("evm_revert", [id]);
      if (!ok) throw new Error(`evm_revert(${id}) returned false`);
    },
    async mine(blocks = 1, intervalSeconds = 0) {
      await rpc("anvil_mine", [`0x${BigInt(blocks).toString(16)}`, `0x${BigInt(intervalSeconds).toString(16)}`]);
    },
    async warp(seconds) {
      await rpc("evm_increaseTime", [`0x${BigInt(seconds).toString(16)}`]);
      await rpc("evm_mine");
    },
    async setNextTimestamp(ts) {
      await rpc("evm_setNextBlockTimestamp", [`0x${BigInt(ts).toString(16)}`]);
      await rpc("evm_mine");
    },
    async head() {
      const b = await rpc("eth_getBlockByNumber", ["latest", false]);
      return { number: BigInt(b.number), timestamp: BigInt(b.timestamp) };
    },
    /** (NUMBER, TIMESTAMP) exactly as the EVM sees them, via a creation-code eth_call. */
    async evmClock() {
      const out = await rpc("eth_call", [{ data: "0x436000524260205260406000f3" }, "latest"]);
      return { number: BigInt(out.slice(0, 66)), timestamp: BigInt(`0x${out.slice(66, 130)}`) };
    },
    async read(address, abi, functionName, args = []) {
      const data = encodeFunctionData({ abi, functionName, args });
      const out = await rpc("eth_call", [{ to: address, data }, "latest"]);
      return decodeFunctionResult({ abi, functionName, data: out, args });
    },
    async tryRead(address, abi, functionName, args = []) {
      try {
        return { ok: true, value: await chain.read(address, abi, functionName, args) };
      } catch (e) {
        return { ok: false, error: e.rpcError?.data ?? e.message };
      }
    },
    async code(address) {
      return rpc("eth_getCode", [getAddress(address), "latest"]);
    },
    async balance(address) {
      return BigInt(await rpc("eth_getBalance", [getAddress(address), "latest"]));
    },
    async storageAt(address, slot) {
      return rpc("eth_getStorageAt", [getAddress(address), slot, "latest"]);
    },
  };
  return chain;
}
