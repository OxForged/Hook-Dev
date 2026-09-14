// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLocalUrl, assertAnvilForkIdentity, guardedRpc, GuardError } from "../src/guard.mjs";

const goodIdentity = {
  clientVersion: "anvil/v1.8.1",
  nodeInfo: { forkConfig: { forkUrl: "https://rpc.mainnet.chain.robinhood.com/", forkBlockNumber: 1 } },
  chainId: "0x1237",
};

/** A fetch that fails the test if it is ever called. */
const forbiddenFetch = async () => {
  throw new Error("network I/O attempted for a URL the guard should have refused");
};

/** A fetch that answers like a node with the given identity. */
function fakeNode(identity) {
  const calls = [];
  const impl = async (url, init) => {
    const { method } = JSON.parse(init.body);
    calls.push({ url, method });
    const result = { web3_clientVersion: identity.clientVersion, anvil_nodeInfo: identity.nodeInfo, eth_chainId: identity.chainId }[method];
    return { json: async () => (result === undefined ? { error: { message: "no" } } : { result }) };
  };
  impl.calls = calls;
  return impl;
}

test("public RPC URLs are refused before any network I/O", async () => {
  for (const url of [
    "https://rpc.mainnet.chain.robinhood.com",
    "https://rpc-robinhood.blockmachine.io",
    "http://10.0.0.5:8545",
    "http://192.168.1.2:8547",
    "http://127.0.0.1.evil.example:8547",
    "http://localhost.example:8547",
  ]) {
    assert.throws(() => assertLocalUrl(url), GuardError, url);
    await assert.rejects(() => guardedRpc(url, forbiddenFetch), GuardError, url);
  }
});

test("non-http schemes, garbage and credentialed URLs are refused", () => {
  for (const url of ["ws://127.0.0.1:8547", "file:///etc/passwd", "not a url", "http://user:pw@127.0.0.1:8547"]) {
    assert.throws(() => assertLocalUrl(url), GuardError, url);
  }
});

test("loopback URLs pass the URL check", () => {
  for (const url of ["http://127.0.0.1:8547", "http://localhost:8547", "http://[::1]:8547"]) {
    assert.doesNotThrow(() => assertLocalUrl(url), url);
  }
});

test("identity: a non-anvil client is refused", () => {
  assert.throws(() => assertAnvilForkIdentity({ ...goodIdentity, clientVersion: "Geth/v1.14.0" }), GuardError);
  assert.throws(() => assertAnvilForkIdentity({ ...goodIdentity, clientVersion: "nitro/v3.5.0" }), GuardError);
  assert.throws(() => assertAnvilForkIdentity({ ...goodIdentity, clientVersion: "hardhat/2.22" }), GuardError);
});

test("identity: an anvil that is not a fork is refused", () => {
  assert.throws(() => assertAnvilForkIdentity({ ...goodIdentity, nodeInfo: { forkConfig: {} } }), GuardError);
  assert.throws(() => assertAnvilForkIdentity({ ...goodIdentity, nodeInfo: null }), GuardError);
});

test("identity: a fork of the wrong chain is refused", () => {
  assert.throws(() => assertAnvilForkIdentity({ ...goodIdentity, chainId: "0x1" }), GuardError);
  assert.throws(() => assertAnvilForkIdentity({ ...goodIdentity, chainId: "0xaa36a7" }), GuardError);
  assert.throws(() => assertAnvilForkIdentity({ ...goodIdentity, chainId: 31337 }), GuardError);
});

test("identity: a local anvil fork of 4663 is accepted", async () => {
  const node = fakeNode(goodIdentity);
  const { identity } = await guardedRpc("http://127.0.0.1:8547", node);
  assert.equal(identity.chainId, 4663);
  assert.ok(node.calls.every((c) => c.url === "http://127.0.0.1:8547"));
});

test("guardedRpc rejects a loopback node that is not anvil", async () => {
  await assert.rejects(() => guardedRpc("http://127.0.0.1:8547", fakeNode({ ...goodIdentity, clientVersion: "Geth/x" })), GuardError);
});
