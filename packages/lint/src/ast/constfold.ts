// SPDX-License-Identifier: MIT
/**
 * Constant folding over the AST.
 *
 * `getHooksRegistrationBitmap()` is a `pure` function returning a constant
 * expression built from named constants — `BEFORE_SWAP | BEFORE_SWAP_RETURNS_DELTA`,
 * `uint16(0x40)`, `1 << 6`. Every rule about the bitmap needs its *value*.
 *
 * Reading it out of the deployed bytecode would mean shipping an EVM; reading
 * it off-chain would mean an RPC and a deployed address. Folding the AST needs
 * neither, works on a contract that has never been deployed, and resolves the
 * constants across inheritance because `referencedDeclaration` points straight
 * at the declaring node. When folding cannot reach a value (a mapping lookup,
 * a branch) it returns `undefined` and the dependent rules stand down rather
 * than guess.
 */

import {
  getNode,
  getNodes,
  getString,
  referencedDeclaration,
  type AstNode,
} from "./node.js";

const UINT256_MASK = (1n << 256n) - 1n;

function parseNumericLiteral(raw: string): bigint | undefined {
  const cleaned = raw.replace(/_/g, "");
  try {
    if (/^0[xX][0-9a-fA-F]+$/.test(cleaned)) return BigInt(cleaned);
    if (/^\d+$/.test(cleaned)) return BigInt(cleaned);
  } catch {
    return undefined;
  }
  return undefined;
}

/** Width of an integer type name like `uint16`, or `undefined`. */
function integerWidth(typeName: string): number | undefined {
  const match = /^u?int(\d*)$/.exec(typeName);
  if (match === null) return undefined;
  const bits = match[1];
  return bits === undefined || bits === "" ? 256 : Number(bits);
}

function truncate(value: bigint, typeName: string | undefined): bigint {
  if (typeName === undefined) return value & UINT256_MASK;
  const width = integerWidth(typeName);
  if (width === undefined) return value & UINT256_MASK;
  const mask = (1n << BigInt(width)) - 1n;
  return value & mask;
}

/**
 * Folds `node` to a value.
 *
 * @param resolve Maps a solc declaration id to its node (see `Compilation.nodesById`).
 */
export function foldConstant(
  node: AstNode | undefined,
  resolve: (id: number) => AstNode | undefined,
  depth = 0,
): bigint | undefined {
  if (node === undefined || depth > 24) return undefined;

  switch (node.nodeType) {
    case "Literal": {
      const kind = getString(node, "kind");
      const value = getString(node, "value");
      if (kind === "number" && value !== undefined) return parseNumericLiteral(value);
      if (kind === "bool" && value !== undefined) return value === "true" ? 1n : 0n;
      return undefined;
    }

    case "Identifier":
    case "MemberAccess": {
      const declId = referencedDeclaration(node);
      if (declId === undefined) return undefined;
      const decl = resolve(declId);
      if (decl?.nodeType !== "VariableDeclaration") return undefined;
      // Only true compile-time constants; a storage read has no static value.
      if (decl["constant"] !== true) return undefined;
      return foldConstant(getNode(decl, "value"), resolve, depth + 1);
    }

    case "TupleExpression": {
      const components = getNodes(node, "components");
      if (components.length !== 1) return undefined;
      return foldConstant(components[0], resolve, depth + 1);
    }

    case "UnaryOperation": {
      const operand = foldConstant(getNode(node, "subExpression"), resolve, depth + 1);
      if (operand === undefined) return undefined;
      switch (getString(node, "operator")) {
        case "-":
          return -operand;
        case "~":
          return ~operand;
        case "+":
          return operand;
        default:
          return undefined;
      }
    }

    case "BinaryOperation": {
      const left = foldConstant(getNode(node, "leftExpression"), resolve, depth + 1);
      const right = foldConstant(getNode(node, "rightExpression"), resolve, depth + 1);
      if (left === undefined || right === undefined) return undefined;
      switch (getString(node, "operator")) {
        case "|":
          return left | right;
        case "&":
          return left & right;
        case "^":
          return left ^ right;
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right === 0n ? undefined : left / right;
        case "%":
          return right === 0n ? undefined : left % right;
        case "<<":
          return right > 512n ? undefined : left << right;
        case ">>":
          return right > 512n ? undefined : left >> right;
        case "**":
          return right > 64n ? undefined : left ** right;
        default:
          return undefined;
      }
    }

    case "FunctionCall": {
      if (getString(node, "kind") !== "typeConversion") return undefined;
      const args = getNodes(node, "arguments");
      const inner = foldConstant(args[0], resolve, depth + 1);
      if (inner === undefined) return undefined;
      const target = getNode(node, "expression");
      const typeName = getString(getNode(target, "typeName"), "name");
      return truncate(inner, typeName);
    }

    default:
      return undefined;
  }
}
