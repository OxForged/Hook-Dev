// SPDX-License-Identifier: MIT
//
// THE HARD GUARD. Nothing in this harness may send a request to an RPC until this module has
// proven, in order:
//
//   1. the URL's host is loopback (127.0.0.1, ::1 or localhost) - checked BEFORE any network I/O,
//      so a public endpoint is refused without a single byte leaving the machine;
//   2. the node identifies itself as anvil (web3_clientVersion);
//   3. the node is a FORK (anvil_nodeInfo.forkConfig.forkUrl is set) - a bare local anvil has no
//      deployed Latch contracts and every assertion would be meaningless;
//   4. eth_chainId is 4663 (Robinhood Chain), i.e. the fork is of the chain whose contracts we test.
//
// Every client the campaign uses is created by `guardedRpc`, and the transport it returns re-checks
// the URL on every request, so a later refactor cannot route a transaction elsewhere by accident.

export const EXPECTED_CHAIN_ID = 4663;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export class GuardError extends Error {
  constructor(message) {
    super(`FORK GUARD REFUSED: ${message}`);
    this.name = "GuardError";
  }
}

/** Pure. Throws unless `url` is an http(s) URL on a loopback host. */
export function assertLocalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new GuardError(`not a URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new GuardError(`protocol ${parsed.protocol} is not http(s)`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new GuardError(`host ${parsed.hostname} is not loopback; this harness only talks to a local anvil fork`);
  }
  if (parsed.username || parsed.password) {
    throw new GuardError("URL carries credentials; a local anvil needs none");
  }
  return parsed;
}

/** Pure. Validates the three identity answers gathered from the node. */
export function assertAnvilForkIdentity({ clientVersion, nodeInfo, chainId }) {
  if (typeof clientVersion !== "string" || !/^anvil\//i.test(clientVersion)) {
    throw new GuardError(`web3_clientVersion is ${JSON.stringify(clientVersion)}, not anvil`);
  }
  const forkUrl = nodeInfo?.forkConfig?.forkUrl;
  if (typeof forkUrl !== "string" || forkUrl.length === 0) {
    throw new GuardError("anvil_nodeInfo reports no forkConfig.forkUrl; this is not a fork");
  }
  const id = typeof chainId === "string" ? Number(BigInt(chainId)) : Number(chainId);
  if (id !== EXPECTED_CHAIN_ID) {
    throw new GuardError(`eth_chainId is ${id}, expected ${EXPECTED_CHAIN_ID} (Robinhood Chain fork)`);
  }
  return { forkUrl, forkBlock: nodeInfo.forkConfig.forkBlockNumber ?? null, chainId: id };
}

/**
 * Raw JSON-RPC over fetch, bound to a URL that has passed `assertLocalUrl`.
 * `fetchImpl` is injectable for tests.
 */
export function makeRawRpc(url, fetchImpl = globalThis.fetch) {
  assertLocalUrl(url);
  let id = 0;
  return async function rpc(method, params = []) {
    assertLocalUrl(url); // re-checked per request, deliberately
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const body = await res.json();
    if (body.error) {
      const e = new Error(`${method}: ${body.error.message}`);
      e.rpcError = body.error;
      throw e;
    }
    return body.result;
  };
}

/** Full guard: URL, then identity. Returns the raw rpc and the verified fork identity. */
export async function guardedRpc(url, fetchImpl = globalThis.fetch) {
  const rpc = makeRawRpc(url, fetchImpl); // throws before any I/O on a non-loopback URL
  const [clientVersion, nodeInfo, chainId] = await Promise.all([
    rpc("web3_clientVersion"),
    rpc("anvil_nodeInfo").catch(() => null),
    rpc("eth_chainId"),
  ]);
  const identity = assertAnvilForkIdentity({ clientVersion, nodeInfo, chainId });
  return { rpc, identity };
}
