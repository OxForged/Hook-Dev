#!/usr/bin/env node
/** `latch <command>` - scaffolder, devnet and bitmap tools under one name. */

import { runBitmap } from "../commands/bitmap.js";
import { runDevnet } from "../commands/devnet.js";
import { runNew } from "../commands/new.js";
import { info, reportFatal, style, UserError } from "../util/log.js";
import { CLI_VERSION } from "../version.js";

const COMMANDS = [
  ["new", "scaffold a hook project (same as `npx create-latch-hook`)"],
  ["devnet", "run a local node with the whole protocol deployed"],
  ["bitmap", "encode, decode and explain hook permission bitmaps"],
] as const;

const USAGE = `${style.bold("latch")} - developer tooling for Latch Protocol ${style.dim(`v${CLI_VERSION}`)}

${style.bold("USAGE")}
  latch <command> [options]

${style.bold("COMMANDS")}
${COMMANDS.map(([name, describe]) => `  ${name.padEnd(10)}${describe}`).join("\n")}

${style.bold("EXAMPLES")}
  latch new my-hook --template dynamic-fee
  latch devnet --fork https://mainnet.base.org
  latch bitmap beforeSwap,beforeSwapReturnsDelta

Run \`latch <command> --help\` for the options of a command.

${style.dim("Latch keeps hook permissions in the pool key, not in the hook's address:")}
${style.dim("there is no CREATE2 salt to mine, and a hook works from anywhere.")}
`;

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    info(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (command === "--version" || command === "-v") {
    info(CLI_VERSION);
    return 0;
  }

  switch (command) {
    case "new":
    case "create":
      return runNew(rest, "latch new", CLI_VERSION);
    case "devnet":
      return runDevnet(rest);
    case "bitmap":
    case "permissions":
      return runBitmap(rest);
    default:
      throw new UserError(
        `unknown command "${command}"`,
        `available commands: ${COMMANDS.map(([name]) => name).join(", ")}`,
      );
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.exitCode = reportFatal(err);
  },
);
