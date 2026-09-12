// SPDX-License-Identifier: MIT
/**
 * `npm run latch:verify` — read every configured address back off the chain.
 *
 * An address book is a claim. This turns each claim into a fact or a failure,
 * before a user ever loads the app:
 *
 *   * does the address have code?
 *   * is the CL pool manager actually a registered app on that Vault? (if not,
 *     nothing works, and the failure at swap time is opaque)
 *   * is a protocol fee controller wired, and what would a pool pay today?
 *   * do the configured tokens agree with their own contracts?
 *   * is the launchpad kit real, pointed at THIS core, and running the hook
 *     bitmap the kit expects?
 *
 * It sends nothing. Every call here is `eth_call` or `eth_getCode`.
 */

import { createPublicClient, erc20Abi, http, fallback, parseAbi, getAddress } from "viem";

import { bad, dim, heading, line, loadConfig, ok } from "./lib/config.mjs";

const VAULT_ABI = parseAbi([
  "function isAppRegistered(address) view returns (bool)",
  "function owner() view returns (address)",
]);
const MANAGER_ABI = parseAbi(["function protocolFeeController() view returns (address)"]);
const CONTROLLER_ABI = parseAbi([
  "function defaultFee() view returns (bool isSet, uint16 zeroForOne, uint16 oneForZero)",
  "function feesDisabled() view returns (bool)",
]);
const REGISTRY_ABI = parseAbi(["function latchCount() view returns (uint256)"]);
const KIT_ABI = parseAbi([
  "function hook() view returns (address)",
  "function clPoolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function permit2() view returns (address)",
  "function registry() view returns (address)",
  "function hookBitmap() view returns (uint16)",
  "function EXPECTED_HOOK_BITMAP() view returns (uint16)",
  "function blockTimeCentis() view returns (uint32)",
]);

const ZERO = "0x0000000000000000000000000000000000000000";
let failures = 0;
let warnings = 0;

function fail(label, detail) {
  failures += 1;
  line("fail", label, detail);
}
function warn(label, detail) {
  warnings += 1;
  line("warn", label, detail);
}
function pass(label, detail) {
  line("ok", label, detail);
}

async function main() {
  const { config, deployments } = await loadConfig();
  const chainId = config.chain.id;
  const known = deployments[chainId];

  heading(`Verifying ${config.brand.name} against chain ${chainId}`);

  if (known === undefined) {
    fail("chain.id", `no Latch core is recorded for chain ${chainId}`);
    return finish();
  }

  const { CHAIN_RPCS } = await import("@latchprotocol/sdk");
  const publicRpcs =
    Object.values(CHAIN_RPCS).find((c) => c.chainId === chainId)?.endpoints.map((e) => e.url) ?? [];
  const urls = [...(config.chain.rpcUrls ?? []), ...publicRpcs];
  if (urls.length === 0) {
    fail("rpc", `no endpoint known for chain ${chainId}; set chain.rpcUrls`);
    return finish();
  }

  const client = createPublicClient({
    transport: fallback(
      urls.map((u) => http(u, { timeout: 12_000, retryCount: 0 })),
      { rank: false, retryCount: 2 },
    ),
  });

  const liveChainId = await client.getChainId().catch(() => null);
  if (liveChainId === null) {
    fail("rpc", `none of the ${urls.length} endpoints answered`);
    return finish();
  }
  if (liveChainId !== chainId) {
    fail("rpc", `endpoints answer chain ${liveChainId}, config says ${chainId}`);
    return finish();
  }
  pass("rpc", `${urls.length} endpoint(s), chain ${liveChainId}`);

  /* ---- core ---- */
  heading("Shared core (Latch's contracts — you did not deploy these)");
  const contracts = { ...known, ...(config.chain.contracts ?? {}) };
  for (const [name, address] of Object.entries(contracts)) {
    if (typeof address !== "string" || !address.startsWith("0x")) continue;
    const code = await client.getCode({ address: getAddress(address) }).catch(() => undefined);
    if (code === undefined || code === "0x") fail(name, `${address} has NO CODE`);
    else pass(name, `${address} (${(code.length - 2) / 2} bytes)`);
  }

  const [registered, vaultOwner] = await Promise.all([
    client
      .readContract({
        address: getAddress(contracts.vault),
        abi: VAULT_ABI,
        functionName: "isAppRegistered",
        args: [getAddress(contracts.clPoolManager)],
      })
      .catch(() => null),
    client
      .readContract({ address: getAddress(contracts.vault), abi: VAULT_ABI, functionName: "owner" })
      .catch(() => null),
  ]);

  if (registered === true) pass("CL manager registered", "the Vault will accept its locks");
  else if (registered === false)
    fail("CL manager registered", "NOT registered on this Vault — no swap can settle");
  else warn("CL manager registered", "could not be read");

  if (vaultOwner !== null) pass("vault owner", vaultOwner);

  /* ---- protocol fee ---- */
  heading("Latch's protocol fee (set by Latch governance, capped at 0.4% by core)");
  const controller = await client
    .readContract({
      address: getAddress(contracts.clPoolManager),
      abi: MANAGER_ABI,
      functionName: "protocolFeeController",
    })
    .catch(() => null);

  if (controller === null) {
    warn("protocolFeeController", "could not be read");
  } else if (controller === ZERO) {
    pass("protocolFeeController", "not wired — the protocol fee is zero today");
  } else {
    const [defaultFee, disabled] = await Promise.all([
      client
        .readContract({ address: controller, abi: CONTROLLER_ABI, functionName: "defaultFee" })
        .catch(() => null),
      client
        .readContract({ address: controller, abi: CONTROLLER_ABI, functionName: "feesDisabled" })
        .catch(() => null),
    ]);
    if (defaultFee === null) {
      warn("protocolFeeController", `${controller} is wired but does not answer defaultFee()`);
    } else {
      const [isSet, zeroForOne, oneForZero] = defaultFee;
      const pips = isSet && disabled !== true ? Math.max(zeroForOne, oneForZero) : 0;
      pass("protocol fee", `${(pips / 10_000).toFixed(4)}% (${pips} pips) — you cannot change this`);
    }
  }

  /* ---- your fee ---- */
  heading("Your fee (this is the part you control)");
  if (!Number.isInteger(config.fee.bps) || config.fee.bps < 0 || config.fee.bps > 100) {
    fail("fee.bps", `${config.fee.bps} is outside 0..100`);
  } else if (config.fee.bps === 0) {
    warn("fee.bps", "0 — this front end earns you nothing");
  } else if (config.fee.wallet === null || config.fee.wallet === ZERO) {
    fail("fee.wallet", `fee.bps is ${config.fee.bps} but no destination is set; the fee is burned`);
  } else {
    const code = await client.getCode({ address: getAddress(config.fee.wallet) }).catch(() => "0x");
    pass(
      "fee",
      `${(config.fee.bps / 100).toFixed(2)}% of swap output to ${config.fee.wallet}` +
        (code !== undefined && code !== "0x" ? " (a contract — make sure it can receive tokens)" : ""),
    );
  }

  /* ---- registry ---- */
  heading("Marketplace");
  if (config.chain.registry === null) {
    warn("chain.registry", "not set — registry surfaces will say 'not configured'");
  } else {
    const count = await client
      .readContract({
        address: getAddress(config.chain.registry),
        abi: REGISTRY_ABI,
        functionName: "latchCount",
      })
      .catch(() => null);
    if (count === null)
      fail("chain.registry", `${config.chain.registry} does not answer latchCount()`);
    else
      pass(
        "chain.registry",
        `${count} listing(s). A live registry with 0 listings and a RETIRED one look identical ` +
          `from here — check the address against a release note.`,
      );
  }

  /* ---- launchpad ---- */
  heading("Launchpad");
  if (config.chain.launchpadKit === null) {
    if (config.features.launchpad) {
      warn(
        "chain.launchpadKit",
        "features.launchpad is on but no kit is configured; the launch screens will say so",
      );
    } else {
      pass("chain.launchpadKit", "not set, and features.launchpad is off");
    }
  } else {
    const kit = getAddress(config.chain.launchpadKit);
    const [hook, kitManager, expected, actual, blockTimeCentis] = await Promise.all([
      client.readContract({ address: kit, abi: KIT_ABI, functionName: "hook" }).catch(() => null),
      client
        .readContract({ address: kit, abi: KIT_ABI, functionName: "clPoolManager" })
        .catch(() => null),
      client
        .readContract({ address: kit, abi: KIT_ABI, functionName: "EXPECTED_HOOK_BITMAP" })
        .catch(() => null),
      client.readContract({ address: kit, abi: KIT_ABI, functionName: "hookBitmap" }).catch(() => null),
      client
        .readContract({ address: kit, abi: KIT_ABI, functionName: "blockTimeCentis" })
        .catch(() => null),
    ]);

    if (hook === null || kitManager === null) {
      fail("chain.launchpadKit", `${kit} does not answer the LaunchpadKit ABI`);
    } else {
      pass("launchpad hook", hook);
      if (getAddress(kitManager) !== getAddress(contracts.clPoolManager)) {
        fail(
          "launchpad core",
          `the kit points at pool manager ${kitManager}, not the one this app uses ` +
            `(${contracts.clPoolManager}). Pools it creates would be invisible here.`,
        );
      } else {
        pass("launchpad core", "wired to the same shared CL pool manager");
      }
      if (expected !== null && actual !== null && expected !== actual) {
        fail("launchpad bitmap", `hook bitmap ${actual} does not match the kit's expected ${expected}`);
      } else if (expected !== null) {
        pass("launchpad bitmap", `0x${Number(expected).toString(16).padStart(4, "0")}`);
      }
      if (blockTimeCentis !== null) {
        const seconds = Number(blockTimeCentis) / 100;
        pass(
          "launchpad block time",
          `${seconds}s per block. A 1,000,000-block decay window is ` +
            `${(1_000_000 * seconds / 86_400).toFixed(1)} days here — the contract counts blocks, not time.`,
        );
      }
    }
  }

  /* ---- tokens ---- */
  heading("Tokens");
  if (config.tokens.length === 0) {
    warn("tokens", "empty — the swap picker will have nothing in it");
  }
  for (const token of config.tokens) {
    const address = getAddress(token.address);
    try {
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
        client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      ]);
      if (symbol !== token.symbol) {
        fail(token.symbol, `contract says "${symbol}", config says "${token.symbol}"`);
      } else if (Number(decimals) !== token.decimals) {
        fail(token.symbol, `contract says ${decimals} decimals, config says ${token.decimals}`);
      } else {
        pass(token.symbol, `${address}, ${decimals} decimals`);
      }
    } catch {
      fail(token.symbol ?? address, `${address} does not answer the ERC-20 ABI`);
    }
  }

  return finish();
}

function finish() {
  process.stdout.write("\n");
  if (failures > 0) {
    process.stdout.write(`${bad(`${failures} failure(s)`)}, ${warnings} warning(s)\n`);
    process.stdout.write(dim("Nothing was sent. Fix latch.config.ts and run this again.\n"));
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${ok("all checks passed")}, ${warnings} warning(s)\n`);
  process.stdout.write(dim("No transaction was sent; every call above was a read.\n"));
}

main().catch((err) => {
  process.stderr.write(`${bad("x")} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
