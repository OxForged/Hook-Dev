/**
 * `latch devnet` - an anvil node with the whole Latch stack already on it.
 *
 * The deployment itself is a Foundry script (`assets/devnet/script/LatchDevnet.s.sol`)
 * that reuses `packages/core/script`'s CREATE3 + BackendGuard machinery, so the local
 * flow matches the production one. This module's job is everything around it:
 * start the node, tell the backend guard what the chain supports, run the script,
 * and read the addresses back out of the JSON the script writes.
 */

import { cp, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getBoolean, getString, parseArgs, renderFlags, type FlagSpecs } from "../util/args.js";
import { info, ok, step, style, table, UserError, warn } from "../util/log.js";
import { writeFileEnsuringDir } from "../util/fsx.js";
import { killTree, requireCommand, runOrThrow, spawnStreaming } from "../util/exec.js";
import { requireFees, resolveWorkspace, type LatchWorkspace } from "../util/workspace.js";

/** anvil's first deterministic account; overridable with --deployer-key. */
const ANVIL_ACCOUNT_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const FLAGS: FlagSpecs = {
  port: { kind: "string", short: "p", placeholder: "<n>", describe: "port anvil listens on", defaultLabel: "8545" },
  host: { kind: "string", placeholder: "<addr>", describe: "address anvil binds to", defaultLabel: "127.0.0.1" },
  fork: {
    kind: "string",
    short: "f",
    placeholder: "<rpc-url>",
    describe: "fork a live chain (passed to anvil as --fork-url)",
  },
  "fork-block-number": {
    kind: "string",
    placeholder: "<n>",
    describe: "block to fork at; requires --fork",
  },
  "rpc-url": {
    kind: "string",
    placeholder: "<url>",
    describe: "deploy to an already-running node instead of starting anvil",
  },
  "deployer-key": {
    kind: "string",
    placeholder: "<hex>",
    describe: "private key used for the deployment",
    defaultLabel: "anvil account 0",
  },
  workdir: {
    kind: "string",
    placeholder: "<path>",
    describe: "where the devnet Foundry project is materialised (build cache lives here)",
    defaultLabel: "~/.latch/devnet",
  },
  core: {
    kind: "string",
    placeholder: "<path>",
    describe: "path to packages/core; also read from LATCH_CORE_PATH",
    defaultLabel: "auto-detected",
  },
  quiet: { kind: "boolean", short: "q", describe: "do not stream anvil's log" },
  json: { kind: "boolean", describe: "print the deployment as JSON and exit" },
  help: { kind: "boolean", short: "h", describe: "show this message" },
};

const USAGE = `${style.bold("latch devnet")} - local Latch node with the protocol deployed

${style.bold("USAGE")}
  latch devnet [options] [-- <extra anvil args>]

${style.bold("EXAMPLES")}
  latch devnet
  latch devnet --port 9545
  latch devnet --fork https://mainnet.base.org --fork-block-number 21000000
  latch devnet -- --block-time 2 --accounts 20

${style.bold("OPTIONS")}
${renderFlags(FLAGS)}

${style.bold("NOTES")}
  The first run compiles the protocol with via_ir and takes a couple of minutes.
  The build cache lives in the working directory, so later runs start in seconds.

  anvil is Cancun-capable, so the DEFAULT (EIP-1153 / transient storage) build is
  used. The legacy SSTORE backend is for pre-Cancun chains only.
`;

interface DevnetDeployment {
  readonly chainId: number;
  readonly deployer: string;
  readonly create3Factory: string;
  readonly vault: string;
  readonly clPoolManager: string;
  readonly binPoolManager: string;
  readonly protocolFeeController: string;
  readonly clPoolManagerRouter: string;
  readonly token0: string;
  readonly token1: string;
  readonly token0Symbol: string;
  readonly token1Symbol: string;
  readonly poolId: string;
  readonly poolParameters: string;
  readonly poolFee: number;
  readonly poolTickSpacing: number;
}

/** Locates `assets/devnet`, both when running from `dist/` and from `src/`. */
function findDevnetAssets(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "assets", "devnet"),
    join(here, "..", "..", "assets", "devnet"),
    join(here, "..", "..", "..", "assets", "devnet"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "script", "LatchDevnet.s.sol"))) return resolve(candidate);
  }
  throw new UserError(
    "could not find the bundled devnet Foundry project",
    "this looks like a broken install of create-latch-hook; try reinstalling",
  );
}

/** Foundry wants forward slashes even on Windows. */
function forgePath(path: string): string {
  return resolve(path).split(sep).join("/");
}

function renderDevnetFoundryToml(workspace: LatchWorkspace, feesPath: string): string {
  const core = `${forgePath(workspace.core)}/`;
  const fees = `${forgePath(feesPath)}/`;

  // Absolute paths on purpose: the working directory is a per-machine build cache
  // that is never committed, and it may sit on a different drive from the checkout,
  // where a relative path cannot be expressed at all on Windows.
  return `# Generated by \`latch devnet\`. Do not edit: it is rewritten on every run.
#
# Default (EIP-1153) backend only. anvil is Cancun-capable, so the legacy
# SSTORE build would merely be slower here - and \`BackendGuard\` refuses to
# deploy a backend the chain does not match.

[profile.default]
src = "src"
test = "test"
script = "script"
out = "foundry-out"
libs = []
solc_version = "0.8.26"
optimizer_runs = 200
via_ir = true
evm_version = "cancun"
bytecode_hash = "none"
allow_paths = ["${forgePath(workspace.core)}", "${forgePath(feesPath)}"]
allow_internal_expect_revert = true
fs_permissions = [
    { access = "read", path = "./script/config" },
    { access = "read-write", path = "./deployments" },
]
remappings = [
    "infinity-core/=${core}",
    "latch-fees/=${fees}",
    "forge-std/=${core}lib/forge-std/src/",
    "ds-test/=${core}lib/forge-std/lib/ds-test/src/",
    "@openzeppelin/=${core}lib/openzeppelin-contracts/",
    "solmate/=${core}lib/solmate/",
    "pancake-create3-factory/=${core}lib/pancake-create3-factory/",
    "hp-transient/=${core}src/libraries/transient/eip1153/",
]
`;
}

async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error !== undefined) throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
  return body.result;
}

async function waitForNode(url: string, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  for (;;) {
    try {
      const chainId = await rpc(url, "eth_chainId");
      return Number.parseInt(String(chainId), 16);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() > deadline) {
      throw new UserError(`node at ${url} did not become ready: ${lastError}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

export async function runDevnet(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, FLAGS);
  if (getBoolean(args, "help")) {
    info(USAGE);
    return 0;
  }

  const quiet = getBoolean(args, "quiet") || getBoolean(args, "json");
  const say = (fn: (message: string) => void, message: string): void => {
    if (!getBoolean(args, "json")) fn(message);
  };

  // --- resolve inputs -------------------------------------------------------
  const port = Number.parseInt(getString(args, "port") ?? "8545", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UserError(`--port must be a TCP port, got "${getString(args, "port")}"`);
  }
  const host = getString(args, "host") ?? "127.0.0.1";
  const externalRpc = getString(args, "rpc-url");
  const rpcUrl = externalRpc ?? `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;

  const forkUrl = getString(args, "fork");
  const forkBlock = getString(args, "fork-block-number");
  if (forkBlock !== undefined && forkUrl === undefined) {
    throw new UserError("--fork-block-number needs --fork <rpc-url>");
  }

  const deployerKey = getString(args, "deployer-key") ?? ANVIL_ACCOUNT_0;
  if (!/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) {
    throw new UserError("--deployer-key must be a 0x-prefixed 32-byte hex private key");
  }

  const workdirFlag = getString(args, "workdir");
  const workdir =
    workdirFlag === undefined
      ? join(homedir(), ".latch", "devnet")
      : isAbsolute(workdirFlag)
        ? workdirFlag
        : resolve(process.cwd(), workdirFlag);

  const workspaceOptions = {
    near: process.cwd(),
    ...(getString(args, "core") === undefined ? {} : { explicit: getString(args, "core") }),
  };
  const workspace = resolveWorkspace(workspaceOptions);
  const feesPath = requireFees(workspace);

  requireCommand("forge", "install Foundry: https://getfoundry.sh");
  if (externalRpc === undefined) requireCommand("anvil", "install Foundry: https://getfoundry.sh");

  // --- materialise the devnet project --------------------------------------
  say(step, `preparing devnet project in ${workdir}`);
  await mkdir(workdir, { recursive: true });
  await cp(findDevnetAssets(), workdir, {
    recursive: true,
    filter: (src) => !src.split(sep).includes("foundry-out") && !src.split(sep).includes("cache"),
  });
  await writeFileEnsuringDir(join(workdir, "foundry.toml"), renderDevnetFoundryToml(workspace, feesPath));
  // vm.writeJson does not create directories, and a devnet that deploys the whole
  // protocol and then loses the addresses is worse than one that fails early.
  await mkdir(join(workdir, "deployments"), { recursive: true });

  // --- start the node -------------------------------------------------------
  let anvil: ReturnType<typeof spawnStreaming> | undefined;
  let stopping = false;

  if (externalRpc === undefined) {
    const anvilArgs = [
      "--host",
      host,
      "--port",
      String(port),
      ...(forkUrl === undefined ? [] : ["--fork-url", forkUrl]),
      ...(forkBlock === undefined ? [] : ["--fork-block-number", forkBlock]),
      ...args.passthrough,
    ];
    say(step, `anvil ${anvilArgs.join(" ")}`);
    anvil = spawnStreaming("anvil", anvilArgs, {
      ...(quiet ? {} : { onLine: (line: string) => info(`${style.dim("anvil")} ${line}`) }),
    });
    anvil.on("exit", (code) => {
      // A non-zero code is expected when we are the ones killing it.
      if (!stopping && code !== null && code !== 0) {
        warn(`anvil exited with code ${code}`);
        process.exitCode = 1;
      }
    });
  } else {
    say(step, `using the node already running at ${externalRpc}`);
  }

  const cleanup = async (): Promise<void> => {
    stopping = true;
    if (anvil?.pid !== undefined) await killTree(anvil.pid);
  };

  try {
    const chainId = await waitForNode(rpcUrl, 30_000);
    say(ok, `node ready at ${rpcUrl} (chain id ${chainId})`);

    // BackendGuard fails closed on an unclassified chain. anvil runs a
    // Cancun-capable EVM whatever it forks, so the EIP-1153 build is correct
    // here even when the forked chain itself predates Cancun.
    await writeFileEnsuringDir(
      join(workdir, "script", "config", "eip1153.json"),
      `${JSON.stringify(
        {
          _comment:
            "Generated by `latch devnet`. anvil runs a Cancun-capable EVM regardless of the chain it forks, so the EIP-1153 build is the correct one on this node.",
          [String(chainId)]: true,
        },
        null,
        2,
      )}\n`,
    );

    say(step, "deploying the protocol (first run compiles with via_ir; this takes a while)");
    await runOrThrow(
      "forge",
      ["script", "script/LatchDevnet.s.sol:LatchDevnet", "--rpc-url", rpcUrl, "--broadcast", "-vv"],
      {
        cwd: workdir,
        env: { ...process.env, PRIVATE_KEY: deployerKey, FOUNDRY_PROFILE: "default" },
        failureHint:
          "if this mentions a missing library, run `forge install` in packages/core; if it mentions UnclassifiedChain, report it as a latch devnet bug",
      },
    );

    const deploymentPath = join(workdir, "deployments", "devnet.json");
    if (!existsSync(deploymentPath)) {
      throw new UserError(
        "the deployment script finished but wrote no addresses",
        `expected ${deploymentPath}`,
      );
    }
    const deployment = JSON.parse(await readFile(deploymentPath, "utf8")) as DevnetDeployment;

    if (getBoolean(args, "json")) {
      info(JSON.stringify({ rpcUrl, deployerKey, ...deployment }, null, 2));
      await cleanup();
      return 0;
    }

    printDeployment(rpcUrl, deployerKey, deployment, forkUrl);

    if (externalRpc !== undefined) {
      await cleanup();
      return 0;
    }

    // --- stay up until interrupted ------------------------------------------
    info("");
    info(style.dim("  anvil is running. Press Ctrl+C to stop it."));

    await new Promise<void>((resolvePromise) => {
      const stop = (): void => {
        info("");
        say(step, "stopping anvil");
        resolvePromise();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      anvil?.once("exit", stop);
    });

    await cleanup();
    return 0;
  } catch (err) {
    await cleanup();
    throw err;
  }
}

function printDeployment(
  rpcUrl: string,
  deployerKey: string,
  d: DevnetDeployment,
  forkUrl: string | undefined,
): void {
  info("");
  info(style.bold("  Latch devnet"));
  info("");
  info(
    table([
      ["rpc url", rpcUrl],
      ["chain id", String(d.chainId)],
      ...(forkUrl === undefined ? [] : ([["forked from", forkUrl]] as Array<readonly [string, string]>)),
      ["deployer", d.deployer],
      ["deployer key", deployerKey],
    ]),
  );
  info("");
  info(style.bold("  Protocol"));
  info("");
  info(
    table([
      ["Vault", d.vault],
      ["CLPoolManager", d.clPoolManager],
      ["BinPoolManager", d.binPoolManager],
      ["ProtocolFeeController", d.protocolFeeController],
      ["Create3Factory", d.create3Factory],
    ]),
  );
  info("");
  info(style.bold("  Local conveniences"));
  info("");
  info(
    table([
      ["CLPoolManagerRouter", d.clPoolManagerRouter],
      [`${d.token0Symbol} (currency0)`, d.token0],
      [`${d.token1Symbol} (currency1)`, d.token1],
    ]),
  );
  info(style.dim("  Both tokens have a public mint(); fund yourself freely."));
  info("");
  info(style.bold("  Seeded pool"));
  info("");
  info(
    table([
      ["pool id", d.poolId],
      ["parameters", d.poolParameters],
      ["fee", `${d.poolFee} (${(d.poolFee / 10_000).toFixed(2)}%)`],
      ["tick spacing", String(d.poolTickSpacing)],
      ["hooks", "none - bitmap 0x0000"],
    ]),
  );
  info("");
  info(style.bold("  Deploy your hook against it"));
  info("");
  info(style.dim("  bash/zsh:"));
  info(`    export PRIVATE_KEY=${deployerKey}`);
  info(`    export CL_POOL_MANAGER=${d.clPoolManager}`);
  info(style.dim("  PowerShell:"));
  info(`    $env:PRIVATE_KEY = "${deployerKey}"`);
  info(`    $env:CL_POOL_MANAGER = "${d.clPoolManager}"`);
  info("");
  info(`    forge script script/Deploy<YourHook>.s.sol --rpc-url ${rpcUrl} --broadcast`);
}
