#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { run } from "../cli/run.js";

const result = run(process.argv.slice(2));
if (result.stdout.length > 0) process.stdout.write(result.stdout);
if (result.stderr.length > 0) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
