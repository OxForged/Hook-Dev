/**
 * Child-process helpers.
 *
 * Windows notes that drive the shape of this module:
 *  - `forge` / `anvil` are `.exe` files on Windows but `foundryup` also installs
 *    `.cmd` shims for some toolchains; `spawn` with `shell: false` will not find
 *    a `.cmd`. `resolveCommand` walks PATHEXT so both work without ever setting
 *    `shell: true` (which would need argument quoting and invites injection).
 *  - Ctrl+C on Windows does not propagate to a detached child, so `anvil` is
 *    started attached and torn down explicitly.
 */

import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { UserError } from "./log.js";

const isWindows = process.platform === "win32";

/** Locates an executable on PATH, honouring PATHEXT on Windows. */
export function resolveCommand(command: string): string | undefined {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return existsSync(command) ? command : undefined;
  }

  const pathValue = process.env["PATH"] ?? process.env["Path"] ?? "";
  const extensions = isWindows
    ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext.length > 0)
    : [""];

  for (const dir of pathValue.split(delimiter).filter((entry) => entry.length > 0)) {
    for (const ext of extensions) {
      const candidate = join(dir.replace(/^"|"$/g, ""), command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export function requireCommand(command: string, hint: string): string {
  const resolved = resolveCommand(command);
  if (resolved === undefined) {
    throw new UserError(`"${command}" was not found on PATH`, hint);
  }
  return resolved;
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Stream child output to this process's stdio as well as capturing it. */
  readonly inherit?: boolean;
}

/** Runs a command to completion and captures its output. */
export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const executable = resolveCommand(command) ?? command;

  const spawnOptions: SpawnOptions = {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  };

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, [...args], spawnOptions);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (options.inherit === true) process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (options.inherit === true) process.stderr.write(text);
    });

    child.on("error", (err) => {
      rejectPromise(new UserError(`failed to start "${command}": ${err.message}`));
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Runs a command and throws a `UserError` when it exits non-zero. */
export async function runOrThrow(
  command: string,
  args: readonly string[],
  options: RunOptions & { readonly failureHint?: string } = {},
): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const tail = [result.stdout, result.stderr]
      .join("\n")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-25)
      .join("\n");
    throw new UserError(
      `${command} ${args.join(" ")}\n  exited with code ${result.code}\n\n${tail}`,
      options.failureHint,
    );
  }
  return result;
}

/** Spawns a long-running child whose output is streamed with a prefix. */
export function spawnStreaming(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly onLine?: (line: string) => void } = {},
): ReturnType<typeof spawn> {
  const executable = resolveCommand(command) ?? command;
  const child = spawn(executable, [...args], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });

  if (options.onLine !== undefined) {
    const onLine = options.onLine;
    let buffer = "";
    const consume = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        onLine(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
  }

  return child;
}

/**
 * Terminates a child process.
 *
 * `SIGTERM` is not implemented on Windows; Node maps `kill()` onto
 * `TerminateProcess`, which does not reach grandchildren, so `taskkill /T` is
 * used there to avoid leaving an orphaned anvil holding port 8545.
 */
export async function killTree(pid: number): Promise<void> {
  if (!isWindows) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    return;
  }
  await run("taskkill", ["/pid", String(pid), "/T", "/F"]);
}
