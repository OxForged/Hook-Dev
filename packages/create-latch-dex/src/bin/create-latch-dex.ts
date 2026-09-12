#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** `npx create-latch-dex <directory>` */

import { runCreate } from "../commands/create.js";
import { reportFatal } from "../util/log.js";

runCreate(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.exitCode = reportFatal(err);
  },
);
