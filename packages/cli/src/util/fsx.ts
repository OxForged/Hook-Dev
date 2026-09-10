/** Filesystem helpers shared by the scaffolder and the devnet command. */

import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Writes a file, creating parent directories as needed. */
export async function writeFileEnsuringDir(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Generated Solidity/TOML/Markdown is written with LF regardless of platform:
  // forge, git and every other consumer are happier that way, and Windows
  // editors all cope with LF.
  await writeFile(path, contents.replace(/\r\n/g, "\n"), "utf8");
}

/** True when `path` does not exist, or exists as an empty directory. */
export async function isEmptyDir(path: string): Promise<boolean> {
  if (!existsSync(path)) return true;
  const entries = await readdir(path);
  return entries.length === 0;
}

/**
 * A POSIX-style relative path from `from` to `to`.
 *
 * Foundry remappings and Solidity imports use forward slashes on every
 * platform, so backslashes produced by `path.relative` on Windows are
 * translated here rather than at each call site.
 */
export function posixRelative(from: string, to: string): string {
  const rel = relative(resolve(from), resolve(to));
  const posix = rel.split(sep).join("/");
  return posix.length === 0 ? "." : posix;
}

/** How many `..` segments a relative path may have before an absolute one is clearer. */
const MAX_PARENT_HOPS = 6;

/**
 * The path a generated `foundry.toml` should use to reach a Latch package.
 *
 * A relative path is preferred: a project generated next to its checkout can be
 * committed and moved with it, and nobody's home directory ends up in a repo.
 * When the two are far apart - a project in a temp directory, or on another
 * Windows drive, where no relative path exists at all - a forward-slashed
 * absolute path is both correct and easier to fix by hand than sixteen `..`s.
 */
export function remappingPath(from: string, to: string): string {
  const absolute = resolve(to).split(sep).join("/");
  const rel = relative(resolve(from), resolve(to));
  if (rel.length === 0) return absolute;
  // path.relative gives an absolute path back when the roots differ (other drive).
  if (isAbsolute(rel)) return absolute;
  const hops = rel.split(sep).filter((segment) => segment === "..").length;
  return hops > MAX_PARENT_HOPS ? absolute : rel.split(sep).join("/");
}
