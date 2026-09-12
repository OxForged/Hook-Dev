// SPDX-License-Identifier: MIT
/** `create-latch-dex <directory>` — the one command this package has. */

import { relative } from "node:path";

import { boolFlag, parseArgs, stringFlag, type ParsedArgs } from "../util/args.js";
import { bold, cyan, dim, info, step, warn } from "../util/log.js";
import { ask, askChoice, isInteractive } from "../util/prompt.js";
import {
  MAX_FEE_BPS,
  resolveOptions,
  SUPPORTED_CHAINS,
  ZERO_ADDRESS,
  type ResolveInput,
  type ScaffoldOptions,
} from "../options.js";
import { scaffold } from "../scaffold.js";
import { CLI_VERSION } from "../version.js";

const HELP = `
${bold("create-latch-dex")} — a DEX and launchpad front end on LatchProtocol's shared core.

  ${cyan("npx create-latch-dex")} <directory> [options]

${bold("Options")}
  --chain <name|id>        Chain to point at. ${[...SUPPORTED_CHAINS.entries()]
    .map(([id, name]) => `${name.toLowerCase().split(" ").pop()} (${id})`)
    .join(", ")}
  --fee-wallet <address>   Address your front end's swap fee is paid to.
  --fee-bps <n>            Swap fee in basis points of the OUTPUT. 0..${MAX_FEE_BPS}. Default 0.
  --features <set>         dex | launchpad | both, or a comma list of swap,pools,launchpad.
  --name <string>          Product name shown in the UI. Defaults from the directory name.
  --package-manager <pm>   npm | pnpm | yarn | bun. Only affects the printed next steps.
  --yes                    Never prompt. Every unset option takes its default, and any
                           option with no safe default is an error rather than a guess.
  --version, -v
  --help, -h

${bold("What it makes")}
  A Vite + React app, one config file (${cyan("latch.config.ts")}), and a verify/deploy
  script. It does NOT deploy Vault or the pool managers — your pools live in the
  core Latch already has deployed and verified on the chain you pick.

${bold("Licence")}
  This scaffold and everything it emits are MIT. The protocol contracts are
  GPL-2.0-or-later and stay that way; the front end reaches them through ABIs,
  which is not linking. See the generated README for the exact boundary.
`;

/**
 * Interactive fill-in for anything the flags did not supply.
 *
 * Skipped entirely when `--yes` is passed or stdin is not a TTY, so CI gets a
 * clean failure naming the missing flag instead of a hang.
 */
async function promptForMissing(input: ResolveInput, flags: ParsedArgs): Promise<ResolveInput> {
  if (boolFlag(flags, "yes") || !isInteractive()) return input;

  const out: {
    -readonly [K in keyof ResolveInput]: ResolveInput[K];
  } = { ...input };

  if (out.directory.trim().length === 0) {
    out.directory = await ask("Project directory", "my-latch-dex");
  }

  if (out.chain === undefined) {
    const names = [...SUPPORTED_CHAINS.keys()].map(String);
    out.chain = await askChoice("Chain id", names, names[0] ?? "4663");
  }

  if (out.features === undefined) {
    out.features = await askChoice("Features", ["dex", "launchpad", "both"], "both");
  }

  if (out.feeBps === undefined) {
    out.feeBps = await ask(
      `Front-end swap fee in bps (0-${MAX_FEE_BPS}, taken from the swap output)`,
      "0",
    );
  }

  if (out.feeWallet === undefined && Number(out.feeBps) > 0) {
    out.feeWallet = await ask("Fee wallet (address the fee is paid to)");
  }

  return out;
}

function nextSteps(options: ScaffoldOptions, target: string): string {
  const pm = options.packageManager;
  const run = pm === "npm" ? "npm run" : pm;
  const installCmd = pm === "yarn" ? "yarn" : `${pm} install`;
  const where = relative(process.cwd(), target) || ".";

  const lines = [
    "",
    bold("Next"),
    `  cd ${where}`,
    `  ${installCmd}`,
    `  ${run} latch:verify        ${dim("# read the configured addresses back off chain")}`,
    `  ${run} dev`,
    "",
    bold("Then, to go to market"),
    `  1. Edit ${cyan("latch.config.ts")}: brand name, logo, colours, links.`,
  ];

  if (options.feeBps === 0) {
    lines.push(
      `  2. Set ${cyan("fee.bps")} above 0. It is 0 today, so the app earns you nothing.`,
    );
  } else {
    lines.push(
      `  2. Fee is ${options.feeBps} bps to ${options.feeWallet}. Check that address before launch.`,
    );
  }

  lines.push(
    `  3. ${run} build, and host the ${cyan("dist/")} directory anywhere static.`,
    "",
    dim("No contracts were deployed and no transaction was sent."),
    "",
  );
  return lines.join("\n");
}

export async function runCreate(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  if (boolFlag(args, "help") || boolFlag(args, "h")) {
    info(HELP);
    return 0;
  }
  if (boolFlag(args, "version") || boolFlag(args, "v")) {
    info(CLI_VERSION);
    return 0;
  }

  const base: ResolveInput = {
    directory: args.positionals[0] ?? "",
    ...(stringFlag(args, "name") === undefined ? {} : { appName: stringFlag(args, "name") }),
    ...(stringFlag(args, "chain") === undefined ? {} : { chain: stringFlag(args, "chain") }),
    ...(stringFlag(args, "fee-wallet") === undefined
      ? {}
      : { feeWallet: stringFlag(args, "fee-wallet") }),
    ...(stringFlag(args, "fee-bps") === undefined ? {} : { feeBps: stringFlag(args, "fee-bps") }),
    ...(stringFlag(args, "features") === undefined
      ? {}
      : { features: stringFlag(args, "features") }),
    ...(stringFlag(args, "package-manager") === undefined
      ? {}
      : { packageManager: stringFlag(args, "package-manager") }),
  };

  const filled = await promptForMissing(base, args);
  const options = resolveOptions(filled);

  step(`${options.appName} -> ${options.directory}`);
  step(`chain ${options.chainId} (${options.chainName}), shared Latch core`);
  step(`features: ${options.features.join(", ")}`);
  if (options.feeBps === 0 || options.feeWallet.toLowerCase() === ZERO_ADDRESS) {
    warn("no front-end fee configured — set fee.bps and fee.wallet in latch.config.ts to earn");
  } else {
    step(`fee: ${options.feeBps} bps of swap output to ${options.feeWallet}`);
  }

  const result = await scaffold(options);
  step(`${result.filesWritten} files written`);
  info(nextSteps(options, result.directory));
  return 0;
}
