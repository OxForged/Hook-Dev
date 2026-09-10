// SPDX-License-Identifier: MIT
/**
 * Minimal, defensive typing for solc's `--ast-compact-json` output.
 *
 * The compact AST is a large, version-drifting shape. Rather than model all of
 * it (and get it subtly wrong on the next solc release), everything is read
 * through checked accessors: a missing or unexpectedly-typed field yields
 * `undefined` instead of a crash, so a rule degrades to "no finding" rather
 * than taking the whole run down.
 */

/** A node in the solc compact AST. */
export type AstNode = { readonly nodeType: string } & Readonly<Record<string, unknown>>;

/** True when `value` looks like an AST node. */
export function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { nodeType?: unknown }).nodeType === "string"
  );
}

export function getString(node: AstNode | undefined, key: string): string | undefined {
  const v = node?.[key];
  return typeof v === "string" ? v : undefined;
}

export function getNumber(node: AstNode | undefined, key: string): number | undefined {
  const v = node?.[key];
  return typeof v === "number" ? v : undefined;
}

export function getBoolean(node: AstNode | undefined, key: string): boolean | undefined {
  const v = node?.[key];
  return typeof v === "boolean" ? v : undefined;
}

/** Reads a child node, or `undefined` when absent/null/not-a-node. */
export function getNode(node: AstNode | undefined, key: string): AstNode | undefined {
  const v = node?.[key];
  return isAstNode(v) ? v : undefined;
}

/** Reads a child node array, skipping anything that is not a node. */
export function getNodes(node: AstNode | undefined, key: string): AstNode[] {
  const v = node?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter(isAstNode);
}

/** `referencedDeclaration` of an Identifier/MemberAccess, when resolved. */
export function referencedDeclaration(node: AstNode | undefined): number | undefined {
  const v = node?.["referencedDeclaration"];
  return typeof v === "number" && v >= 0 ? v : undefined;
}

/** The `typeString` solc inferred for an expression, if any. */
export function typeString(node: AstNode | undefined): string | undefined {
  return getString(getNode(node, "typeDescriptions"), "typeString");
}

/** A decoded `offset:length:sourceIndex` source location. */
export interface SrcLocation {
  readonly offset: number;
  readonly length: number;
  readonly sourceIndex: number;
}

/** Parses the `src` field. Returns `undefined` for malformed values. */
export function parseSrc(node: AstNode | undefined): SrcLocation | undefined {
  const raw = getString(node, "src");
  if (raw === undefined) return undefined;
  const parts = raw.split(":");
  if (parts.length < 3) return undefined;
  const offset = Number(parts[0]);
  const length = Number(parts[1]);
  const sourceIndex = Number(parts[2]);
  if (!Number.isInteger(offset) || !Number.isInteger(length) || !Number.isInteger(sourceIndex)) {
    return undefined;
  }
  return { offset, length, sourceIndex };
}

/**
 * Every child node of `node`, in no particular order.
 *
 * Walks all own enumerable properties, so it does not need to know the child
 * key names of every statement/expression kind.
 */
export function childNodes(node: AstNode): AstNode[] {
  const out: AstNode[] = [];
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (isAstNode(value)) {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) out.push(item);
    }
  }
  return out;
}

/** Depth-first pre-order traversal. Return `false` from `visit` to skip a subtree. */
export function walk(root: AstNode, visit: (node: AstNode) => boolean | void): void {
  const stack: AstNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (visit(node) === false) continue;
    const children = childNodes(node);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child !== undefined) stack.push(child);
    }
  }
}

/** Collects every descendant (and `root` itself) with one of `nodeTypes`. */
export function collect(root: AstNode, ...nodeTypes: readonly string[]): AstNode[] {
  const wanted = new Set(nodeTypes);
  const out: AstNode[] = [];
  walk(root, (node) => {
    if (wanted.has(node.nodeType)) out.push(node);
  });
  return out;
}

/**
 * Like {@link collect}, but does not descend into nodes matching `stopAt`.
 *
 * Used to keep, say, a nested function-body scan from leaking into unrelated
 * sibling declarations.
 */
export function collectShallow(
  root: AstNode,
  nodeTypes: readonly string[],
  stopAt: readonly string[],
): AstNode[] {
  const wanted = new Set(nodeTypes);
  const barriers = new Set(stopAt);
  const out: AstNode[] = [];
  walk(root, (node) => {
    if (node !== root && barriers.has(node.nodeType)) return false;
    if (wanted.has(node.nodeType)) out.push(node);
    return true;
  });
  return out;
}
