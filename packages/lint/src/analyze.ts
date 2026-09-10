// SPDX-License-Identifier: MIT
/** The analysis entry point: target -> findings. */

import { existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  loadAbis,
  loadCompilation,
  NoCompilerOutputError,
  type Compilation,
} from "./ast/compilation.js";
import { findProjectRoot, normalisePath, readFoundryConfig } from "./ast/project.js";
import { sortFindings, type Finding } from "./finding.js";
import { findHookContracts, type HookContract } from "./model/hook.js";
import { ALL_RULES, materialise, type Rule } from "./rules/index.js";

export { NoCompilerOutputError };

/** How the analysis should be scoped. */
export interface AnalyzeOptions {
  /** Foundry project root. Defaults to the nearest ancestor with a `foundry.toml`. */
  readonly root?: string;
  /** A specific build-info JSON, bypassing discovery. */
  readonly buildInfo?: string;
  /** Foundry profile whose `src`/`out` to read. */
  readonly profile?: string;
  /**
   * Compile the project into a scratch directory when its own output carries no
   * AST. Defaults to `true`. Set `false` for a strictly read-only run.
   */
  readonly build?: boolean;
  /** Compile even when usable output already exists. */
  readonly rebuild?: boolean;
  /** Only run these rule ids. */
  readonly only?: readonly string[];
  /** Skip these rule ids. */
  readonly exclude?: readonly string[];
  /** Rule set override, for tests. */
  readonly rules?: readonly Rule[];
}

/** What the linter found, plus enough context to explain how it looked. */
export interface AnalysisResult {
  readonly findings: readonly Finding[];
  /** Hooks that were analysed. */
  readonly hooks: readonly HookSummary[];
  /** Non-fatal problems worth telling the user about. */
  readonly warnings: readonly string[];
  readonly projectRoot: string;
  readonly astOrigin: string;
  readonly rulesRun: readonly string[];
}

/** One analysed contract, for the report header. */
export interface HookSummary {
  readonly name: string;
  readonly file: string;
  readonly poolType: string;
  readonly dialect: string;
  readonly isAbstract: boolean;
  readonly declaredBitmap: number | undefined;
  readonly implementedCallbacks: readonly string[];
}

function selectRules(options: AnalyzeOptions): Rule[] {
  const base = options.rules ?? ALL_RULES;
  const only = options.only;
  const exclude = new Set(options.exclude ?? []);
  return base.filter(
    (rule) =>
      (only === undefined || only.length === 0 || only.includes(rule.id)) && !exclude.has(rule.id),
  );
}

/** True when `hook` was declared in a file the target selects. */
function inScope(compilation: Compilation, hook: HookContract, targetAbsolute: string, isFile: boolean): boolean {
  const source = compilation.sources.get(hook.ref.sourceIndex);
  if (source === undefined) return false;
  const file = normalisePath(source.absolutePath);
  const target = normalisePath(targetAbsolute);
  return isFile ? file === target : file.startsWith(target.endsWith("/") ? target : `${target}/`) || file === target;
}

/** Runs the rule set over every hook the target selects. */
export function analyze(target: string, options: AnalyzeOptions = {}): AnalysisResult {
  const targetAbsolute = resolve(target);
  if (!existsSync(targetAbsolute)) {
    throw new Error(`path does not exist: ${targetAbsolute}`);
  }
  const isFile = statSync(targetAbsolute).isFile();

  const root = options.root !== undefined ? resolve(options.root) : findProjectRoot(targetAbsolute);
  if (root === undefined) {
    throw new NoCompilerOutputError(
      `no foundry.toml found at or above ${targetAbsolute}.\n` +
        `latch-lint reads the AST that \`forge build\` writes, so it needs a Foundry project. ` +
        `Pass --root <dir> if the project lives elsewhere.`,
    );
  }

  const project = readFoundryConfig(root, options.profile);
  const compilation = loadCompilation(project, {
    ...(options.buildInfo === undefined ? {} : { buildInfo: options.buildInfo }),
    ...(options.build === undefined ? {} : { build: options.build }),
    ...(options.rebuild === undefined ? {} : { rebuild: options.rebuild }),
  });
  const abis = loadAbis(compilation.artifactDir);

  const warnings: string[] = [];
  if (compilation.stale) {
    warnings.push(
      "a .sol file under src/ is newer than the compiler output being analysed; rebuild for up-to-date results",
    );
  }
  if (compilation.origin === "artifacts") {
    warnings.push(
      "no build-info was available, so per-artifact ASTs were used; cross-file resolution may be incomplete",
    );
  }

  const rules = selectRules(options);
  const findings: Finding[] = [];
  const hooks: HookSummary[] = [];

  for (const hook of findHookContracts(compilation)) {
    if (!inScope(compilation, hook, targetAbsolute, isFile)) continue;

    const source = compilation.sources.get(hook.ref.sourceIndex);
    hooks.push({
      name: hook.ref.name,
      file: source?.unitPath ?? hook.ref.unitPath,
      poolType: hook.poolType,
      dialect: hook.dialect,
      isAbstract: hook.isAbstract,
      declaredBitmap: hook.declaredBitmap,
      implementedCallbacks: [...hook.callbacks.values()]
        .filter((binding) => binding.status === "implemented")
        .map((binding) => binding.spec.name),
    });

    const context = { compilation, hook, abis };
    for (const rule of rules) {
      let drafts;
      try {
        drafts = rule.run(context);
      } catch (error) {
        warnings.push(
          `${rule.id} failed on ${hook.ref.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      findings.push(...materialise(rule, context, drafts));
    }
  }

  if (hooks.length === 0) {
    warnings.push(
      `no hook contracts found under ${relative(root, targetAbsolute) || "."}. ` +
        "A contract is treated as a hook when it declares `getHooksRegistrationBitmap()` " +
        "(Latch) or `getHookPermissions()` (Uniswap v4), or implements a hook callback.",
    );
  }

  return {
    findings: sortFindings(findings),
    hooks,
    warnings,
    projectRoot: root,
    astOrigin: compilation.generated
      ? `${compilation.origin}, compiled by latch-lint into a scratch directory (the project was not built with --ast)`
      : `${compilation.origin} (${normalisePath(relative(root, compilation.originPath) || compilation.originPath)})`,
    rulesRun: rules.map((rule) => rule.id),
  };
}
