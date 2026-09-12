// SPDX-License-Identifier: MIT
/**
 * `npm run latch:deploy` — stand up your launchpad against the shared core and
 * write the resulting addresses back into `latch.config.ts`.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE YOU EXPECT IT TO DEPLOY SOMETHING
 * ---------------------------------------------------------------------------
 *
 * **In the default path there is nothing to deploy, and that is the product.**
 * `Vault`, both pool managers, the router, the position managers and the quoter
 * are already live and verified — you point at them. `LaunchpadKit` takes every
 * launch parameter as a call argument and holds no owner, no treasury and no
 * mutable state, so ONE instance serves every tenant: your launches differ from
 * anyone else's by their arguments, not by their bytecode. The same is true of
 * `LaunchGuardHook`, whose authority is a per-pool `launchOwner`, and of
 * `RevShareHook`, whose entire configuration is per pool.
 *
 * So this script's real job is **resolve and verify**: confirm the addresses
 * exist, confirm the kit is wired to the same core this app reads, and write
 * what it found into your config. That is the whole shared-core deployment.
 *
 * **If you do want your own kit instance**, run it with `--own-kit`. It will
 * print the exact `forge script` invocation and refuse to run it. That refusal
 * is a licensing boundary, not laziness — see below.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SOLIDITY IS NOT IN THIS PACKAGE
 * ---------------------------------------------------------------------------
 *
 * This template is MIT, and it is MIT because everything it touches reaches the
 * protocol through ABIs rather than through GPL source. `LaunchpadKit` and
 * `LaunchGuardHook` import Latch core and are therefore GPL-2.0-or-later, and
 * so is their compiled bytecode. Vendoring either into an MIT package — as
 * source, as an artifact, or as a hex string — would put GPL code inside an MIT
 * distribution and break the licence analysis this whole template rests on.
 *
 * The GPL code stays where it is GPL. You fetch it, you build it, you deploy
 * it, and your front end stays MIT and yours to close-source.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE SENDS A TRANSACTION. Ever, on any flag.
 * ---------------------------------------------------------------------------
 */

import { createPublicClient, fallback, getAddress, http, parseAbi } from "viem";

import { bad, dim, heading, line, loadConfig, ok, writeChainField } from "./lib/config.mjs";

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

const HOOK_ABI = parseAbi([
  "function poolManager() view returns (address)",
  "function getHooksRegistrationBitmap() pure returns (uint16)",
]);

function flag(name) {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact !== -1) {
    const next = process.argv[exact + 1];
    return next !== undefined && !next.startsWith("--") ? next : true;
  }
  const prefixed = process.argv.find((a) => a.startsWith(`--${name}=`));
  return prefixed === undefined ? undefined : prefixed.slice(name.length + 3);
}

const USAGE = `
latch:deploy — resolve your launchpad against Latch's shared core.

  npm run latch:deploy                       explain the state of play, change nothing
  npm run latch:deploy -- --kit 0x…          verify a LaunchpadKit and write it to the config
  npm run latch:deploy -- --registry 0x…     verify a LatchRegistry and write it to the config
  npm run latch:deploy -- --own-kit          print the forge command to deploy your own kit
  npm run latch:deploy -- --dry-run          verify but do not write

No flag sends a transaction. This script has no signer and no private key path.
`;

async function main() {
  if (flag("help") !== undefined || flag("h") !== undefined) {
    process.stdout.write(USAGE);
    return;
  }

  const { config, deployments } = await loadConfig();
  const chainId = config.chain.id;
  const core = deployments[chainId];
  if (core === undefined) {
    throw new Error(`No Latch core is recorded for chain ${chainId}.`);
  }

  if (flag("own-kit") !== undefined) {
    printOwnKitInstructions(core, config);
    return;
  }

  const contracts = { ...core, ...(config.chain.contracts ?? {}) };
  const { CHAIN_RPCS } = await import("@latchprotocol/sdk");
  const urls = [
    ...(config.chain.rpcUrls ?? []),
    ...(Object.values(CHAIN_RPCS).find((c) => c.chainId === chainId)?.endpoints.map((e) => e.url) ??
      []),
  ];
  const client = createPublicClient({
    transport: fallback(
      urls.map((u) => http(u, { timeout: 12_000, retryCount: 0 })),
      { rank: false, retryCount: 2 },
    ),
  });

  const dryRun = flag("dry-run") !== undefined;
  let wrote = 0;

  const kitFlag = flag("kit");
  if (typeof kitFlag === "string") {
    heading(`Verifying LaunchpadKit ${kitFlag}`);
    const kit = getAddress(kitFlag);
    const problems = await verifyKit(client, kit, contracts);
    if (problems.length > 0) {
      for (const problem of problems) line("fail", "launchpadKit", problem);
      throw new Error("The kit did not verify. Nothing was written.");
    }
    if (dryRun) {
      line("ok", "launchpadKit", `${kit} verified. --dry-run, so latch.config.ts is unchanged.`);
    } else {
      await writeChainField("launchpadKit", kit);
      wrote += 1;
      line("ok", "launchpadKit", `${kit} written to latch.config.ts`);
    }
  }

  const registryFlag = flag("registry");
  if (typeof registryFlag === "string") {
    heading(`Verifying LatchRegistry ${registryFlag}`);
    const registry = getAddress(registryFlag);
    const count = await client
      .readContract({
        address: registry,
        abi: parseAbi(["function latchCount() view returns (uint256)"]),
        functionName: "latchCount",
      })
      .catch(() => null);
    if (count === null) {
      throw new Error(`${registry} does not answer latchCount(). Nothing was written.`);
    }
    line(
      "warn",
      "registry",
      `${count} listing(s). A RETIRED registry answers this call too and looks identical — ` +
        `confirm the address against a Latch release note, not against this number.`,
    );
    if (dryRun) {
      line("ok", "registry", "--dry-run, so latch.config.ts is unchanged.");
    } else {
      await writeChainField("registry", registry);
      wrote += 1;
      line("ok", "registry", `${registry} written to latch.config.ts`);
    }
  }

  if (typeof kitFlag !== "string" && typeof registryFlag !== "string") {
    printStateOfPlay(config, contracts);
    return;
  }

  process.stdout.write(
    `\n${ok(`${wrote} field(s) updated`)}. ${dim("No transaction was sent.")}\n` +
      `${dim("Run `npm run latch:verify` to re-check everything.")}\n`,
  );
}

async function verifyKit(client, kit, contracts) {
  const problems = [];

  const code = await client.getCode({ address: kit }).catch(() => undefined);
  if (code === undefined || code === "0x") return [`${kit} has no code on this chain`];

  const [hook, kitManager, expected, actual] = await Promise.all([
    client.readContract({ address: kit, abi: KIT_ABI, functionName: "hook" }).catch(() => null),
    client
      .readContract({ address: kit, abi: KIT_ABI, functionName: "clPoolManager" })
      .catch(() => null),
    client
      .readContract({ address: kit, abi: KIT_ABI, functionName: "EXPECTED_HOOK_BITMAP" })
      .catch(() => null),
    client.readContract({ address: kit, abi: KIT_ABI, functionName: "hookBitmap" }).catch(() => null),
  ]);

  if (hook === null || kitManager === null) {
    return [`${kit} does not answer the LaunchpadKit ABI — is it a LaunchpadKit?`];
  }

  /* The single most damaging misconfiguration: a kit wired to a DIFFERENT pool
     manager. It deploys fine, it creates launches fine, and none of them ever
     appear in this app, because this app reads the other manager's logs. */
  if (getAddress(kitManager) !== getAddress(contracts.clPoolManager)) {
    problems.push(
      `the kit is wired to pool manager ${kitManager}, but this app reads ` +
        `${contracts.clPoolManager}. Launches it creates would be invisible here.`,
    );
  }

  if (expected !== null && actual !== null && expected !== actual) {
    problems.push(`hook bitmap ${actual} does not match the kit's expected ${expected}`);
  }

  const hookManager = await client
    .readContract({ address: hook, abi: HOOK_ABI, functionName: "poolManager" })
    .catch(() => null);
  if (hookManager !== null && getAddress(hookManager) !== getAddress(contracts.clPoolManager)) {
    problems.push(`the kit's hook is wired to pool manager ${hookManager}, not the shared one`);
  }

  return problems;
}

function printStateOfPlay(config, contracts) {
  heading("Shared core — already deployed, nothing for you to do");
  line("ok", "vault", contracts.vault);
  line("ok", "clPoolManager", contracts.clPoolManager);
  line("ok", "universalRouter", contracts.universalRouter);
  line("ok", "clPositionManager", contracts.clPositionManager);
  process.stdout.write(
    dim(
      "\n  Your pools live in that Vault. You are not deploying it, you cannot upgrade it,\n" +
        "  and neither can anyone else operating a front end on it.\n",
    ),
  );

  heading("Launchpad");
  if (config.chain.launchpadKit !== null) {
    line("ok", "launchpadKit", `${config.chain.launchpadKit} (configured)`);
    process.stdout.write(dim("\n  Run `npm run latch:verify` to check it against the chain.\n"));
  } else {
    line("warn", "launchpadKit", "not configured");
    process.stdout.write(
      dim(
        "\n  Latch has no shared LaunchpadKit deployed on any chain as of this template's\n" +
          "  release — the mainnet deploy script has only ever been dry-run. So there are\n" +
          "  two honest options today:\n\n" +
          "    1. Ship without the launchpad. Set features.launchpad to false and the\n" +
          "       launch screens disappear rather than sitting there broken.\n" +
          "    2. Deploy your own instance. `npm run latch:deploy -- --own-kit`\n" +
          "       prints exactly how, then feed the address back with `--kit 0x…`.\n\n" +
          "  When Latch ships a shared instance, pointing at it is one `--kit` away and\n" +
          "  costs you nothing.\n",
      ),
    );
  }

  heading("Your fee");
  if (config.fee.bps > 0) {
    line("ok", "fee", `${(config.fee.bps / 100).toFixed(2)}% of swap output to ${config.fee.wallet}`);
    process.stdout.write(
      dim("\n  No contract holds this. It is an action inside the swap's own call path.\n"),
    );
  } else {
    line("warn", "fee", "0 bps — this front end earns nothing");
  }

  process.stdout.write(`\n${dim("Nothing was written and no transaction was sent.")}\n`);
}

function printOwnKitInstructions(core, config) {
  heading("Deploying your own LaunchpadKit against the shared core");

  process.stdout.write(
    "\n" +
      "This script will not run these commands for you. LaunchpadKit and\n" +
      "LaunchGuardHook import Latch core, so they are GPL-2.0-or-later — and this\n" +
      "template is MIT precisely because it contains no GPL source and no bytecode\n" +
      "compiled from any. Vendoring them here would break that, and with it your\n" +
      "right to close-source your fork of this front end.\n" +
      "\n" +
      "The contracts stay where they are GPL. You fetch, build and deploy them.\n" +
      "\n" +
      "  1. Get the GPL launchpad sources and build them. They live in the Latch\n" +
      "     monorepo under `packages/launchpad`; take the repository URL from\n" +
      "     Latch's own documentation rather than from this script, which does not\n" +
      "     know it and will not invent one:\n" +
      "\n" +
      "       git clone <the Latch monorepo>\n" +
      "       cd <that repo>/packages/launchpad\n" +
      "       forge build\n" +
      "\n" +
      "  2. Deploy the hook. It is `LaunchGuardHook(ICLPoolManager)` — one argument,\n" +
      "     and it must be the SHARED manager below or your launches will not appear\n" +
      "     in any app reading Latch's core:\n" +
      "\n" +
      `       export CL_POOL_MANAGER=${core.clPoolManager}\n` +
      "       export PRIVATE_KEY=...           # never commit this, never echo it\n" +
      "       forge script script/DeployLaunchGuardHookMainnet.s.sol \\\n" +
      "         --rpc-url $RPC_URL --broadcast --verify\n" +
      "\n" +
      "  3. Deploy the kit. Its constructor is\n" +
      "     `(ICLPoolManager, LaunchGuardHook, ICLPositionManager, IAllowanceTransfer,\n" +
      "       IHookRegistryListing, uint32 blockTimeCentis)`:\n" +
      "\n" +
      `       export LAUNCH_GUARD_HOOK=0x...   # from step 2\n` +
      `       export CL_POSITION_MANAGER=${core.clPositionManager}\n` +
      `       export PERMIT2=${core.permit2}\n` +
      `       export LAUNCHPAD_REGISTRY=${config.chain.registry ?? "0x0000000000000000000000000000000000000000"}\n` +
      `       export LAUNCHPAD_BLOCK_TIME_CENTIS=${blockTimeHint(core.chainId)}\n` +
      "       forge script script/DeployLaunchpadKitMainnet.s.sol \\\n" +
      "         --rpc-url $RPC_URL --broadcast --verify\n" +
      "\n" +
      "  4. Point this app at it, which verifies it first:\n" +
      "\n" +
      "       npm run latch:deploy -- --kit 0xYourKitAddress\n" +
      "\n",
  );

  process.stdout.write(
    "Two things to get right, because neither can be fixed afterwards:\n" +
      "\n" +
      "  · LAUNCHPAD_BLOCK_TIME_CENTIS is IMMUTABLE and is how the kit converts a\n" +
      "    start delay in seconds into a block count. Wrong by 100x and every launch\n" +
      "    you schedule starts at the wrong time. It is hundredths of a second per\n" +
      "    block: 1200 on a 12s chain, 10 on a 0.1s chain. Measure it, do not assume.\n" +
      "\n" +
      "  · LAUNCHPAD_REGISTRY at address(0) disables registry listing on that kit\n" +
      "    PERMANENTLY. That is a valid choice, but it is not reversible: the kit has\n" +
      "    no owner and no setter, by design.\n" +
      "\n",
  );

  process.stdout.write(dim("Nothing was run and no transaction was sent.\n"));
}

/**
 * A block-time starting point, stated as a hint rather than a value to trust.
 *
 * Deliberately not presented as authoritative: block times drift, and this
 * number is welded into the kit forever. The instructions say to measure it.
 */
function blockTimeHint(chainId) {
  if (chainId === 11155111) return "1200 # ~12s, Ethereum Sepolia — MEASURE IT";
  return "10 # ~0.1s on Robinhood Chain — MEASURE IT, this is welded in forever";
}

main().catch((err) => {
  process.stderr.write(`${bad("x")} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
