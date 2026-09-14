// SPDX-License-Identifier: MIT
/* Log-endpoint ordering: a REORDER of the probed list for `eth_getLogs`, never an
   addition, with private providers still first. */

import { describe, expect, it } from "vitest";

import {
  CHAIN_RPCS,
  LOG_RANGE_ENDPOINTS,
  resolveEndpoints,
  resolveLogEndpoints,
} from "../src/chains/endpoints.js";

describe("LOG_RANGE_ENDPOINTS", () => {
  it("only names endpoints already in that chain's probed list", () => {
    for (const [chainId, urls] of Object.entries(LOG_RANGE_ENDPOINTS)) {
      const listed = resolveEndpoints(Number(chainId));
      for (const u of urls) expect(listed).toContain(u);
    }
  });

  it("puts Robinhood's canonical endpoint first for logs", () => {
    expect(resolveLogEndpoints(4663)[0]).toBe("https://rpc.mainnet.chain.robinhood.com");
  });
});

describe("resolveLogEndpoints", () => {
  it("is the same SET as resolveEndpoints, reordered", () => {
    for (const cfg of Object.values(CHAIN_RPCS)) {
      const reads = resolveEndpoints(cfg.chainId);
      const logs = resolveLogEndpoints(cfg.chainId);
      expect([...logs].sort()).toEqual([...reads].sort());
      expect(logs.length).toBe(new Set(logs).size);
    }
  });

  it("leaves chains without a verified log endpoint in probed order", () => {
    expect(resolveLogEndpoints(1)).toEqual(resolveEndpoints(1));
  });

  it("keeps private providers ahead of the verified public one", () => {
    const env = { LATCH_RPC_4663: "https://keyed.example/a, https://keyed.example/b" };
    const logs = resolveLogEndpoints(4663, env);
    expect(logs.slice(0, 3)).toEqual([
      "https://keyed.example/a",
      "https://keyed.example/b",
      "https://rpc.mainnet.chain.robinhood.com",
    ]);
  });

  it("does not change the read order", () => {
    expect(resolveEndpoints(4663)[0]).toBe(CHAIN_RPCS.robinhood.endpoints[0]?.url);
  });
});
