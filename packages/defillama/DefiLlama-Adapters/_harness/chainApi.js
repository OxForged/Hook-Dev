/**
 * LOCAL HARNESS - not an upstream file (the leading underscore marks it as such).
 *
 * A stand-in for `@defillama/sdk`'s `ChainApi`, enough to run
 * `projects/latch/index.js` against a real node. Balances are kept as bigint and
 * never priced: this harness can prove which tokens are counted and in what
 * amount, and deliberately cannot produce a dollar figure.
 */

let nextId = 0;

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const json = await res.json();
  // Never swallow: an empty result reported as a zero balance would be a lie.
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

/**
 * @param {{ chain: string, rpcUrl: string, block?: number, maxBlockRange?: number }} opts
 */
function makeApi(opts) {
  const balances = new Map();
  return {
    chain: opts.chain,
    block: opts.block,
    rpcUrl: opts.rpcUrl,
    maxBlockRange: opts.maxBlockRange || 10000,
    call: (...args) => rpc(opts.rpcUrl, ...args),
    add(token, amount) {
      const key = String(token).toLowerCase();
      balances.set(key, (balances.get(key) || 0n) + BigInt(amount));
    },
    getBalances() {
      return Object.fromEntries([...balances.entries()].filter(([, v]) => v !== 0n));
    },
  };
}

module.exports = { makeApi, rpc };
