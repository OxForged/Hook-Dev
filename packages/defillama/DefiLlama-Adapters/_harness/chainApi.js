/**
 * LOCAL HARNESS - not an upstream file (the leading underscore marks it as such).
 *
 * A stand-in for `@defillama/sdk`'s `ChainApi`, enough to run
 * `projects/latch/index.js` against a real node. Balances are kept as bigint and
 * never priced: this harness can prove which tokens are counted and in what
 * amount, and deliberately cannot produce a dollar figure.
 */

let nextId = 0;

/** Some public nodes answer a per-minute quota with this code, or with HTTP 429. */
const RATE_LIMITED = -32029;
const MAX_RATE_LIMIT_RETRIES = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(url, method, params) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }),
    });
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep((retryAfter > 0 ? retryAfter * 1000 : 10_000) + 500);
      continue;
    }
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const json = await res.json();
    if (!json.error) return json.result;
    // A quota response is not data: wait it out, then fail loudly if it persists.
    if (json.error.code === RATE_LIMITED && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleep(((json.error.data && json.error.data.retry_after_ms) || 10_000) + 500);
      continue;
    }
    // Never swallow: an empty result reported as a zero balance would be a lie.
    throw new Error(`${method}: ${json.error.message}`);
  }
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
