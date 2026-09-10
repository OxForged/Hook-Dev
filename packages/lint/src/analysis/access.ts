// SPDX-License-Identifier: MIT
/**
 * Access-control analysis.
 *
 * A guard can be written three ways and all three have to be recognised or the
 * rule is useless: a modifier defined in this contract, a modifier inherited
 * from a base (and possibly overridden), or an inline `if (msg.sender != x)
 * revert`. All three are resolved through the AST, because a modifier's name
 * tells you nothing - `onlyOwner` on `beforeSwap` is not pool-manager auth, and
 * a project-specific name like `fromManager` is.
 */

import type { Compilation } from "../ast/compilation.js";
import { getNode, getString, referencedDeclaration, type AstNode } from "../ast/node.js";
import {
  containsRevert,
  msgSenderComparisons,
  resolveNamedDeclaration,
  resolveVirtual,
} from "../ast/query.js";

const POOL_MANAGER_TYPES = /\b(I?CL|I?Bin)?Pool[Mm]anager\b|\bIVault\b|\bVault\b/;
const POOL_MANAGER_NAMES = /^_?(cl|bin)?(pool)?manager$|^_?vault$|manager$/i;

/** What kind of authorization a function carries. */
export interface GuardAnalysis {
  /** Any `msg.sender` restriction at all. */
  readonly guarded: boolean;
  /** The restriction names the pool manager (or the vault). */
  readonly guardsPoolManager: boolean;
  /** Node to point at when reporting. */
  readonly at: AstNode | undefined;
  /** Human description of what was found, for the message. */
  readonly description: string;
}

/** Resolves a modifier invocation to the definition that would actually run. */
export function resolveModifierDefinition(
  compilation: Compilation,
  chain: readonly AstNode[],
  invocation: AstNode,
): AstNode | undefined {
  const nameNode = getNode(invocation, "modifierName");
  const name = getString(nameNode, "name") ?? getString(nameNode, "memberName");
  if (name !== undefined) {
    const virtualResolved = resolveVirtual(chain, name, "ModifierDefinition");
    if (virtualResolved !== undefined) return virtualResolved;
  }
  const declId = referencedDeclaration(nameNode);
  if (declId === undefined) return undefined;
  const decl = compilation.nodesById.get(declId);
  return decl?.nodeType === "ModifierDefinition" ? decl : undefined;
}

function comparesAgainstPoolManager(
  compilation: Compilation,
  against: AstNode | undefined,
): boolean {
  if (against === undefined) return false;
  const declaration = resolveNamedDeclaration(compilation, against);
  if (declaration !== undefined) {
    const name = getString(declaration, "name");
    if (name !== undefined && POOL_MANAGER_NAMES.test(name)) return true;
    const typeName = getString(getNode(declaration, "typeDescriptions"), "typeString");
    if (typeName !== undefined && POOL_MANAGER_TYPES.test(typeName)) return true;
  }
  const inlineType = getString(getNode(against, "typeDescriptions"), "typeString");
  if (inlineType !== undefined && POOL_MANAGER_TYPES.test(inlineType)) return true;
  return false;
}

/** Analyses a single body (function or modifier) for an inline sender check. */
function analyseBody(compilation: Compilation, body: AstNode | undefined): GuardAnalysis | undefined {
  if (body === undefined) return undefined;
  const comparisons = msgSenderComparisons(body);
  if (comparisons.length === 0) return undefined;
  if (!containsRevert(body)) return undefined;

  for (const comparison of comparisons) {
    if (comparesAgainstPoolManager(compilation, comparison.against)) {
      return {
        guarded: true,
        guardsPoolManager: true,
        at: comparison.node,
        description: "an inline `msg.sender` check against the pool manager",
      };
    }
  }
  const first = comparisons[0];
  return {
    guarded: true,
    guardsPoolManager: false,
    at: first?.node,
    description: "an inline `msg.sender` check, but not against the pool manager",
  };
}

/**
 * Does `fn` restrict who may call it, and does that restriction name the pool
 * manager?
 */
export function analyseGuard(
  compilation: Compilation,
  chain: readonly AstNode[],
  functionsOnPath: readonly AstNode[],
): GuardAnalysis {
  let weaker: GuardAnalysis | undefined;

  for (const fn of functionsOnPath) {
    for (const invocation of getModifiers(fn)) {
      const definition = resolveModifierDefinition(compilation, chain, invocation);
      const analysed = analyseBody(compilation, getNode(definition, "body"));
      const modifierName =
        getString(getNode(invocation, "modifierName"), "name") ??
        getString(getNode(invocation, "modifierName"), "memberName") ??
        "<modifier>";

      if (analysed !== undefined) {
        const described: GuardAnalysis = {
          guarded: true,
          guardsPoolManager: analysed.guardsPoolManager,
          at: invocation,
          description: analysed.guardsPoolManager
            ? `the \`${modifierName}\` modifier, which checks \`msg.sender\` against the pool manager`
            : `the \`${modifierName}\` modifier, which checks \`msg.sender\` against something other than the pool manager`,
        };
        if (described.guardsPoolManager) return described;
        weaker = weaker ?? described;
        continue;
      }

      // The definition could not be read (a base outside this compilation).
      // Fall back to the name, which is the one place a name is better than
      // nothing: refusing to recognise `onlyPoolManager` would be a worse error
      // than trusting it.
      if (definition === undefined && /pool.?manager|only.?manager/i.test(modifierName)) {
        return {
          guarded: true,
          guardsPoolManager: true,
          at: invocation,
          description: `the \`${modifierName}\` modifier (definition not in this compilation; matched by name)`,
        };
      }
    }

    const inline = analyseBody(compilation, getNode(fn, "body"));
    if (inline !== undefined) {
      if (inline.guardsPoolManager) return inline;
      weaker = weaker ?? inline;
    }
  }

  return weaker ?? { guarded: false, guardsPoolManager: false, at: undefined, description: "no caller restriction" };
}

function getModifiers(fn: AstNode): AstNode[] {
  const value = fn["modifiers"];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is AstNode =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { nodeType?: unknown }).nodeType === "string" &&
      (item as { nodeType: string }).nodeType === "ModifierInvocation",
  );
}
