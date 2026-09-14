// SPDX-License-Identifier: MIT
// Starts anvil forking Robinhood Chain (4663). Local only: binds 127.0.0.1.
//
// Why rpc.ordofi.network by default: rpc.mainnet.chain.robinhood.com keeps state for only
// ~5,000-20,000 L2 blocks (measured 2026-09-13: back 5,000 answered, back 20,000 returned
// "metadata is not found"), i.e. 8-30 minutes at 0.1 s blocks. A fork lazily fetches every slot
// at the fork block, so on that endpoint every new slot read fails once the window passes and the
// campaign dies mid-run. ordofi served eth_call 1,000,000 blocks back in ~100 ms.
// rpc-robinhood.blockmachine.io rate-limits at 300 CU/minute, too low for a fork.
//
// Usage: node scripts/start-fork.mjs [--block N] [--port 8547] [--fork-url URL]
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const forkUrl = opt("fork-url", process.env.FORK_URL ?? "https://rpc.ordofi.network");
const port = opt("port", "8547");
const block = opt("block", process.env.FORK_BLOCK);

// --hardfork cancun: every Latch contract is compiled for cancun. Under anvil's default (post-Prague)
// hardfork each mined block writes the EIP-2935 history contract, whose storage is lazily fetched
// from the remote per block - measured 2026-09-13: ~8,900 blocks in 9 minutes, then a timeout.
// Block-denominated windows here run to 432,000 blocks, so mining must stay local.
const args = ["--fork-url", forkUrl, "--host", "127.0.0.1", "--port", port, "--hardfork", "cancun", "--retries", "8", "--timeout", "60000", "--fork-retry-backoff", "2000"];
if (block) args.push("--fork-block-number", block);
console.log(`anvil ${args.join(" ")}`);
const child = spawn("anvil", args, { stdio: "inherit" });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
