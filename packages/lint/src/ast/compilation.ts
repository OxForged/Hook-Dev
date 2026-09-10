// SPDX-License-Identifier: MIT
/**
 * Loads a coherent set of source ASTs plus their text.
 *
 * A "coherent set" matters: solc node ids and source indices are only
 * meaningful within a single compilation. Mixing ASTs from two `forge build`
 * runs would make `referencedDeclaration` resolve to the wrong declaration, so
 * a build-info file (one compilation, all sources) is always preferred and the
 * per-artifact fallback de-duplicates by path.
 */

import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  findArtifacts,
  findBuildInfos,
  findProjectBuildInfos,
  newestSolidityMtime,
  normalisePath,
  type FoundryProject,
} from "./project.js";
import { buildAstForProject } from "./forge.js";
import { isAstNode, parseSrc, walk, type AstNode } from "./node.js";

/** One Solidity file, as the compiler saw it. */
export interface LoadedSource {
  /** Source index used by every `src` field in this compilation. */
  readonly sourceIndex: number;
  /** Path as solc recorded it (usually relative to the project root). */
  readonly unitPath: string;
  /** Best-effort absolute path on disk. */
  readonly absolutePath: string;
  readonly ast: AstNode;
  /** File text, when recoverable. `undefined` disables snippets for this file. */
  readonly content: string | undefined;
  /** Byte offset of the start of each line, for offset -> line/column. */
  readonly lineStarts: readonly number[];
}

/** A whole compilation: every source's AST, indexed for cross-file resolution. */
export interface Compilation {
  readonly project: FoundryProject;
  /** How the ASTs were obtained, for the report header. */
  readonly origin: "build-info" | "artifacts";
  readonly originPath: string;
  /** Directory whose artifacts carry the ABIs matching these ASTs. */
  readonly artifactDir: string;
  /** True when the linter compiled the project itself into a scratch directory. */
  readonly generated: boolean;
  /** True when the loaded compilation does not cover every requested source. */
  readonly partial: boolean;
  readonly sources: ReadonlyMap<number, LoadedSource>;
  /** Every declaration node, by solc id. Powers `referencedDeclaration`. */
  readonly nodesById: ReadonlyMap<number, AstNode>;
  /** Source index each node id lives in. */
  readonly sourceIndexByNodeId: ReadonlyMap<number, number>;
  /** True when a `.sol` file is newer than the compiler output. */
  readonly stale: boolean;
}

interface RawSource {
  sourceIndex: number;
  unitPath: string;
  ast: AstNode;
  content: string | undefined;
}

function computeLineStarts(content: string | undefined): number[] {
  if (content === undefined) return [0];
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function readIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function absolutise(root: string, unitPath: string): string {
  return isAbsolute(unitPath) ? unitPath : resolve(root, unitPath);
}

/** Thrown when no usable compiler output could be found. */
export class NoCompilerOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoCompilerOutputError";
  }
}

function parseJson(path: string): unknown {
  const text = readFileSync(path, "utf8");
  return JSON.parse(text) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sourcesFromBuildInfo(path: string, root: string): RawSource[] {
  const doc = asRecord(parseJson(path));
  const output = asRecord(doc?.["output"]);
  const outputSources = asRecord(output?.["sources"]);
  if (outputSources === undefined) return [];

  const input = asRecord(doc?.["input"]);
  const inputSources = asRecord(input?.["sources"]);

  const out: RawSource[] = [];
  for (const [key, value] of Object.entries(outputSources)) {
    const entry = asRecord(value);
    const ast = entry?.["ast"];
    if (!isAstNode(ast)) continue;
    const sourceIndex = typeof entry?.["id"] === "number" ? (entry["id"] as number) : undefined;
    if (sourceIndex === undefined) continue;

    const unitPathFromAst = typeof ast["absolutePath"] === "string" ? (ast["absolutePath"] as string) : key;
    const inline = asRecord(inputSources?.[key])?.["content"];
    const content =
      typeof inline === "string" ? inline : readIfExists(absolutise(root, unitPathFromAst)) ?? readIfExists(key);

    out.push({ sourceIndex, unitPath: unitPathFromAst, ast, content });
  }
  return out;
}

function sourcesFromArtifacts(outDir: string, root: string): RawSource[] {
  const byPath = new Map<string, RawSource>();
  for (const artifactPath of findArtifacts(outDir)) {
    let doc: Record<string, unknown> | undefined;
    try {
      doc = asRecord(parseJson(artifactPath));
    } catch {
      continue;
    }
    const ast = doc?.["ast"];
    if (!isAstNode(ast)) continue;
    const sourceIndex = typeof ast["id"] === "number" ? (ast["id"] as number) : undefined;
    if (sourceIndex === undefined) continue;
    const unitPath = typeof ast["absolutePath"] === "string" ? (ast["absolutePath"] as string) : artifactPath;
    const normalised = normalisePath(unitPath);
    if (byPath.has(normalised)) continue;
    byPath.set(normalised, {
      sourceIndex,
      unitPath,
      ast,
      content: readIfExists(absolutise(root, unitPath)),
    });
  }
  return [...byPath.values()];
}

/** Reads the ABI of every artifact, keyed by contract name. */
export function loadAbis(outDir: string): Map<string, readonly Record<string, unknown>[]> {
  const out = new Map<string, readonly Record<string, unknown>[]>();
  for (const artifactPath of findArtifacts(outDir)) {
    let doc: Record<string, unknown> | undefined;
    try {
      doc = asRecord(parseJson(artifactPath));
    } catch {
      continue;
    }
    const abi = doc?.["abi"];
    if (!Array.isArray(abi)) continue;
    const name = artifactPath.replace(/\\/g, "/").split("/").pop()?.replace(/\.json$/, "");
    if (name === undefined || name.length === 0) continue;
    if (out.has(name)) continue;
    out.set(
      name,
      abi.filter((entry): entry is Record<string, unknown> => asRecord(entry) !== undefined),
    );
  }
  return out;
}

/** Options for {@link loadCompilation}. */
export interface LoadOptions {
  /** Explicit build-info file, bypassing discovery. */
  readonly buildInfo?: string;
  /**
   * Compile the project into a scratch directory when the existing output has
   * no AST. Defaults to `true`; `false` makes the run strictly read-only.
   */
  readonly build?: boolean;
  /** Compile even when usable output already exists. */
  readonly rebuild?: boolean;
  /**
   * Absolute paths that must all appear in the loaded compilation.
   *
   * Foundry writes one build-info per compiler input set, so an incremental
   * rebuild leaves a newest-but-partial file behind. Without this check the
   * linter happily analyses whichever two of your four hooks happened to be
   * recompiled last and reports the rest as clean, which is worse than failing.
   */
  readonly mustCover?: readonly string[];
}

interface Candidate {
  readonly buildInfoPath: string | undefined;
  readonly outDir: string;
}

function candidatesFor(project: FoundryProject, options: LoadOptions): Candidate[] {
  if (options.buildInfo !== undefined) {
    return [{ buildInfoPath: resolve(options.buildInfo), outDir: project.outDir }];
  }
  const out: Candidate[] = findProjectBuildInfos(project.outDir).map((path) => ({
    buildInfoPath: path,
    outDir: project.outDir,
  }));
  out.push({ buildInfoPath: undefined, outDir: project.outDir });
  return out;
}

interface Loaded {
  readonly raw: RawSource[];
  readonly origin: Compilation["origin"];
  readonly originPath: string;
  readonly outDir: string;
}

function covers(raw: readonly RawSource[], root: string, mustCover: readonly string[]): boolean {
  if (mustCover.length === 0) return true;
  const present = new Set(raw.map((item) => normalisePath(absolutise(root, item.unitPath)).toLowerCase()));
  return mustCover.every((path) => present.has(normalisePath(resolve(path)).toLowerCase()));
}

function firstUsable(
  candidates: readonly Candidate[],
  root: string,
  mustCover: readonly string[],
): { covered: Loaded | undefined; any: Loaded | undefined } {
  let any: Loaded | undefined;
  for (const candidate of candidates) {
    let raw: RawSource[] = [];
    try {
      raw =
        candidate.buildInfoPath === undefined
          ? sourcesFromArtifacts(candidate.outDir, root)
          : sourcesFromBuildInfo(candidate.buildInfoPath, root);
    } catch {
      raw = [];
    }
    if (raw.length === 0) continue;
    const loaded: Loaded = {
      raw,
      origin: candidate.buildInfoPath === undefined ? "artifacts" : "build-info",
      originPath: candidate.buildInfoPath ?? candidate.outDir,
      outDir: candidate.outDir,
    };
    any = any ?? loaded;
    if (covers(raw, root, mustCover)) return { covered: loaded, any };
  }
  return { covered: undefined, any };
}

/** Loads the compilation covering `project`, compiling one if necessary. */
export function loadCompilation(project: FoundryProject, options: LoadOptions = {}): Compilation {
  const mustCover = options.mustCover ?? [];
  const canBuild = options.build !== false && options.buildInfo === undefined;

  let attempt =
    options.rebuild === true
      ? { covered: undefined, any: undefined }
      : firstUsable(candidatesFor(project, options), project.root, mustCover);
  let found = attempt.covered;
  let fallback = attempt.any;
  let generated = false;

  for (const force of [false, true]) {
    if (found !== undefined || !canBuild) break;
    // The first pass lets Foundry's cache do its job; the second forces one
    // whole-project compilation when the incremental result did not cover the
    // files being linted.
    const built = buildAstForProject(project.root, force);
    if (!built.ok) {
      if (fallback !== undefined) break;
      throw new NoCompilerOutputError(
        `no solc AST found under ${project.outDir}, and compiling one failed.\n${built.message}\n\n` +
          `Foundry only writes ASTs when asked. Either run \`forge build --ast\` in ${project.root}, ` +
          `or fix the build error above.`,
      );
    }
    generated = true;
    attempt = firstUsable(
      [
        ...findBuildInfos(built.buildInfoDir).map((path) => ({ buildInfoPath: path, outDir: built.outDir })),
        { buildInfoPath: undefined, outDir: built.outDir },
      ],
      project.root,
      mustCover,
    );
    found = attempt.covered;
    fallback = attempt.any ?? fallback;
  }

  const resolved = found ?? fallback;
  if (resolved === undefined) {
    throw new NoCompilerOutputError(
      `no solc AST found under ${project.outDir}.\n` +
        `latch-lint reads the AST Foundry emits with \`forge build --ast\`; run that in ${project.root}, ` +
        `or point at another project with --root, or a specific build-info file with --build-info.`,
    );
  }

  const { raw, origin, originPath, outDir } = resolved;
  const partial = found === undefined && mustCover.length > 0;
  const sources = new Map<number, LoadedSource>();
  for (const item of raw) {
    sources.set(item.sourceIndex, {
      sourceIndex: item.sourceIndex,
      unitPath: normalisePath(item.unitPath),
      absolutePath: absolutise(project.root, item.unitPath),
      ast: item.ast,
      content: item.content,
      lineStarts: computeLineStarts(item.content),
    });
  }

  const nodesById = new Map<number, AstNode>();
  const sourceIndexByNodeId = new Map<number, number>();
  for (const source of sources.values()) {
    walk(source.ast, (node) => {
      const id = node["id"];
      if (typeof id === "number" && !nodesById.has(id)) {
        nodesById.set(id, node);
        sourceIndexByNodeId.set(id, source.sourceIndex);
      }
    });
  }

  let stale = false;
  if (!generated) {
    try {
      const builtAt = statSync(originPath).mtimeMs;
      const newestSource = newestSolidityMtime(project.srcDir);
      stale = newestSource !== undefined && newestSource > builtAt + 1000;
    } catch {
      stale = false;
    }
  }

  return {
    project,
    origin,
    originPath,
    artifactDir: outDir,
    generated,
    partial,
    sources,
    nodesById,
    sourceIndexByNodeId,
    stale,
  };
}

/** A human-facing file:line:column, resolved from a node's `src`. */
export interface SourcePosition {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** The source line's text, trimmed of trailing whitespace. */
  readonly snippet: string | undefined;
}

/** Resolves a node to `file:line:column` plus the line it sits on. */
export function positionOf(compilation: Compilation, node: AstNode | undefined): SourcePosition {
  const loc = parseSrc(node);
  if (loc === undefined) return { file: "<unknown>", line: 0, column: 0, snippet: undefined };
  const source = compilation.sources.get(loc.sourceIndex);
  if (source === undefined) {
    return { file: `<source ${loc.sourceIndex}>`, line: 0, column: 0, snippet: undefined };
  }

  const starts = source.lineStarts;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    const start = starts[mid];
    if (start !== undefined && start <= loc.offset) low = mid;
    else high = mid - 1;
  }
  const lineStart = starts[low] ?? 0;
  const line = low + 1;
  const column = loc.offset - lineStart + 1;

  let snippet: string | undefined;
  if (source.content !== undefined) {
    const nextStart = starts[low + 1] ?? source.content.length;
    snippet = source.content.slice(lineStart, nextStart).replace(/\s+$/, "");
  }

  return { file: source.unitPath, line, column, snippet };
}

/** The exact source text a node spans, when the file text is available. */
export function textOf(compilation: Compilation, node: AstNode | undefined): string | undefined {
  const loc = parseSrc(node);
  if (loc === undefined) return undefined;
  const source = compilation.sources.get(loc.sourceIndex);
  if (source?.content === undefined) return undefined;
  return source.content.slice(loc.offset, loc.offset + loc.length);
}
