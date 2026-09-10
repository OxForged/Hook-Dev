/**
 * LOCAL HARNESS STUB - do not submit. Upstream this is
 * DefiLlama-Adapters/projects/helper/unwrapLPs.js (~1000 lines).
 *
 * Implements only `sumTokens2({ api, ownerTokens, tokens, owner, permitFailure })`,
 * flattened the same way upstream does:
 *
 *   ownerTokens.map(([tokens, owner]) => tokens.forEach(t => tokensAndOwners.push([t, owner])))
 *
 * and with upstream's native-currency rule: an entry whose token is `nullAddress`
 * (or the 0xeee… gas-token sentinel) is answered with `eth_getBalance` on the
 * owner rather than `balanceOf`. That is what lets a Latch pool key's native
 * currency - the zero address - be passed straight through.
 */

const { rpc } = require("../../_harness/chainApi.js");
const { nullAddress, gasTokens } = require("./tokenMapping.js");

const BALANCE_OF = "0x70a08231";
const word = (address) => String(address).slice(2).toLowerCase().padStart(64, "0");

async function sumTokens2({ api, ownerTokens = [], tokens = [], owner, permitFailure = false }) {
  const tokensAndOwners = [];
  for (const [list, holder] of ownerTokens) {
    if (typeof holder !== "string") throw new Error("sumTokens2: invalid owner in ownerTokens");
    if (!Array.isArray(list)) throw new Error("sumTokens2: invalid token list in ownerTokens");
    for (const token of list) tokensAndOwners.push([token, holder]);
  }
  if (owner) for (const token of tokens) tokensAndOwners.push([token, owner]);

  const block = api.block ? "0x" + api.block.toString(16) : "latest";

  for (const [token, holder] of tokensAndOwners) {
    const isNative =
      String(token).toLowerCase() === nullAddress ||
      gasTokens.includes(String(token).toLowerCase());
    try {
      const raw = isNative
        ? await rpc(api.rpcUrl, "eth_getBalance", [holder, block])
        : await rpc(api.rpcUrl, "eth_call", [
            { to: token, data: BALANCE_OF + word(holder) },
            block,
          ]);
      // A contract that is not an ERC20 returns "0x"; upstream's multicall would
      // report a failure for it, which permitFailure then skips.
      if (raw === "0x") throw new Error(`balanceOf reverted for ${token}`);
      api.add(isNative ? nullAddress : token, BigInt(raw));
    } catch (e) {
      if (!permitFailure) throw e;
    }
  }

  return api.getBalances();
}

const sumTokensExport = (args) => async (api) => sumTokens2({ api, ...args });

module.exports = { sumTokens2, sumTokensExport };
