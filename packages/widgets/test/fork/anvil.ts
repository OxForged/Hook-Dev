// SPDX-License-Identifier: MIT
/**
 * Anvil lifecycle for the fork harness.
 *
 * Every fork suite runs against a **local** anvil forked from Sepolia. Nothing
 * here ever broadcasts to a public network: the only RPC the harness writes to
 * is `http://127.0.0.1:<port>`, and the upstream endpoint is used read-only, by
 * anvil, to serve state.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/** Public Sepolia endpoint used when the environment names no other. */
export const DEFAULT_FORK_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** Upstream endpoint anvil forks from. Override with `LATCH_FORK_RPC_URL`. */
export function forkRpcUrl(): string {
  return process.env["LATCH_FORK_RPC_URL"] ?? DEFAULT_FORK_RPC_URL;
}

/** Optional pinned fork block. Unset means "latest", which is the default. */
export function forkBlockNumber(): number | null {
  const raw = process.env["LATCH_FORK_BLOCK"];
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** A running anvil instance. */
export interface AnvilInstance {
  readonly url: string;
  readonly port: number;
  stop(): Promise<void>;
}

async function rpcReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { result?: string };
    return typeof body.result === "string";
  } catch {
    return false;
  }
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    // anvil spawns no children, but SIGTERM on Windows is a hard terminate
    // anyway; taskkill is the reliable form and never throws into the suite.
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      /* fall through to kill() */
    }
  }
  child.kill("SIGTERM");
}

/**
 * Starts an anvil forked from {@link forkRpcUrl}.
 *
 * Resolves once the node answers `eth_chainId`. Rejects with anvil's own stderr
 * when it exits early, because "connection refused" on its own tells you
 * nothing about why.
 */
export async function startAnvilFork(options: { port?: number } = {}): Promise<AnvilInstance> {
  const port = options.port ?? 8545 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const args = [
    "--fork-url",
    forkRpcUrl(),
    "--port",
    String(port),
    "--host",
    "127.0.0.1",
    "--silent",
    // Room for a position-manager mint plus a swap in one block.
    "--gas-limit",
    "60000000",
    "--base-fee",
    "0",
  ];
  const block = forkBlockNumber();
  if (block !== null) args.push("--fork-block-number", String(block));

  const child = spawn("anvil", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  let exited = false;
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout?.on("data", () => {
    /* --silent, but drain anyway so the pipe never fills */
  });
  child.on("exit", () => {
    exited = true;
  });
  child.on("error", (error: Error) => {
    stderr += `\n${error.message}`;
    exited = true;
  });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`[fork] anvil exited before becoming ready:\n${stderr.trim()}`);
    }
    if (await rpcReady(url)) {
      return {
        url,
        port,
        async stop() {
          if (exited) return;
          const closed = new Promise<void>((resolvePromise) => {
            child.once("exit", () => resolvePromise());
          });
          killTree(child);
          await Promise.race([closed, delay(5_000)]);
        },
      };
    }
    await delay(250);
  }
  killTree(child);
  throw new Error(
    `[fork] anvil did not become ready within 90s on ${url}. stderr:\n${stderr.trim()}`,
  );
}

/** `true` when the `anvil` binary is on PATH. */
export async function anvilAvailable(): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const probe = spawn("anvil", ["--version"], { stdio: "ignore" });
    probe.on("error", () => resolvePromise(false));
    probe.on("exit", (code) => resolvePromise(code === 0));
  });
}
