#!/usr/bin/env node
/** `npx create-latch-hook <name>` - the scaffolder, on its own. */

import { runNew } from "../commands/new.js";
import { info, reportFatal } from "../util/log.js";
import { CLI_VERSION } from "../version.js";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--version" || argv[0] === "-v") {
    info(CLI_VERSION);
    return 0;
  }
  return runNew(argv, "create-latch-hook", CLI_VERSION);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.exitCode = reportFatal(err);
  },
);
