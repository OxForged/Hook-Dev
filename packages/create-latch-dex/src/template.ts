// SPDX-License-Identifier: MIT
/**
 * Turning the template into a tenant's project.
 *
 * The template is a REAL, working app, not a pile of fragments with holes in
 * it. Every file under `template/` typechecks and builds exactly as it sits on
 * disk, against defaults that point at a chain Latch is actually deployed on.
 * That is deliberate: a template you cannot run until a generator has filled it
 * in is a template nobody can review, and a broken emitted project is
 * indistinguishable from a broken template.
 *
 * Substitution therefore replaces VALID VALUES with other valid values, in two
 * shapes:
 *
 *   1. `"__LATCH_APP_NAME__"` — a placeholder inside a string literal.
 *   2. `4663 /* __LATCH_CHAIN_ID__ *\/` — a real literal tagged by a trailing
 *      comment. The literal and its tag are replaced together, so the template
 *      compiles before substitution and the generated file carries no marker
 *      comment afterwards.
 */

import type { ScaffoldOptions } from "./options.js";
import { ALL_FEATURES } from "./options.js";

/** Files that get token substitution. Everything else is copied byte for byte. */
export const SUBSTITUTED_FILES: readonly string[] = [
  "package.json",
  "index.html",
  "README.md",
  "latch.config.ts",
];

export type TokenMap = Readonly<Record<string, string>>;

export function tokensFor(options: ScaffoldOptions): TokenMap {
  const tokens: Record<string, string> = {
    __LATCH_APP_NAME__: options.appName,
    __LATCH_PACKAGE_NAME__: options.packageName,
    __LATCH_CHAIN_ID__: String(options.chainId),
    __LATCH_CHAIN_NAME__: options.chainName,
    __LATCH_FEE_WALLET__: options.feeWallet,
    __LATCH_FEE_BPS__: String(options.feeBps),
  };
  for (const feature of ALL_FEATURES) {
    tokens[`__LATCH_FEATURE_${feature.toUpperCase()}__`] = String(
      options.features.includes(feature),
    );
  }
  return tokens;
}

const TAGGED = (token: string): RegExp =>
  // A literal (number, boolean or quoted string) followed by its marker comment.
  new RegExp(String.raw`(?:-?\d+|true|false|"[^"]*"|'[^']*')\s*\/\*\s*${token}\s*\*\/`, "g");

/**
 * Escapes a value for the position it is being substituted into.
 *
 * Only string-literal positions need escaping, and only for the quote character
 * and backslashes. A product name containing an apostrophe is ordinary; a
 * product name that terminates the string literal around it is a broken build.
 */
function escapeForSingleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeForJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** Applies both substitution shapes to one file's contents. */
export function applyTokens(relativePath: string, contents: string, tokens: TokenMap): string {
  let out = contents;

  // Shape 2 first: the tagged literal carries the token inside a comment, and
  // running shape 1 first would rewrite the tag and leave the literal behind.
  for (const [token, value] of Object.entries(tokens)) {
    out = out.replace(TAGGED(token), () => literalFor(relativePath, value));
  }

  // Shape 1: bare placeholders inside string literals and prose.
  for (const [token, value] of Object.entries(tokens)) {
    if (!out.includes(token)) continue;
    const escaped = relativePath.endsWith(".json")
      ? escapeForJsonString(value)
      : escapeForSingleQuoted(value);
    out = out.split(token).join(escaped);
  }

  return out;
}

/**
 * How a substituted value is written back as source.
 *
 * `true`, `false` and integers go in bare; anything else is quoted, in the
 * quoting style of the file it lands in.
 */
function literalFor(relativePath: string, value: string): string {
  if (value === "true" || value === "false") return value;
  if (/^-?\d+$/.test(value)) return value;
  if (relativePath.endsWith(".json")) return `"${escapeForJsonString(value)}"`;
  return `'${escapeForSingleQuoted(value)}'`;
}

/** Every token that must be resolvable, for the "no marker left behind" check. */
export function findUnresolvedTokens(contents: string): string[] {
  const found = contents.match(/__LATCH_[A-Z0-9_]+__/g);
  return found === null ? [] : [...new Set(found)];
}
