// SPDX-License-Identifier: MIT
/**
 * Turns a contract in the AST into the thing the rules actually reason about:
 * a hook, with a declared permission set and, for each callback, the function
 * body that really runs.
 *
 * The second part is the hard one. Both Latch's `BaseCLHook` and Uniswap's
 * `BaseHook` use the same shape: the external callback the pool manager calls
 * is `final` in the base and immediately forwards to an internal `_callback`
 * that subclasses override, with the base's default reverting so an
 * un-overridden permission fails loudly. Read naively, every subclass of such a
 * base "implements" all ten callbacks and every bitmap looks wrong. Resolving
 * the delegation - and resolving it virtually, most-derived first - is what
 * makes the bitmap and selector rules produce zero false positives on a real
 * hook built on that base.
 */

import type { PoolType } from "@latchprotocol/sdk";
import type { Compilation } from "../ast/compilation.js";
import { foldConstant } from "../ast/constfold.js";
import {
  collect,
  getBoolean,
  getNode,
  getNodes,
  getString,
  referencedDeclaration,
  typeStringOf,
  type AstNode,
} from "../ast/node.js";
import {
  allContracts,
  functionsInChain,
  isImplemented,
  linearizedChain,
  membersOf,
  resolveVirtual,
  type ContractRef,
} from "../ast/query.js";
import {
  ALL_CALLBACK_NAMES,
  callbackFunctions,
  LATCH_BITMAP_FUNCTION,
  V4_PERMISSION_FIELD_BITS,
  V4_PERMISSIONS_FUNCTION,
  type CallbackSpec,
} from "./callbacks.js";

/** Which hook ABI the contract targets. */
export type HookDialect = "latch" | "uniswap-v4";

/** How a declared callback resolves in the concrete contract. */
export type CallbackStatus =
  /** No external entry point exists at all. */
  | "absent"
  /** An entry point exists but every path reverts (the base's "not implemented" default). */
  | "not-implemented"
  /** Real logic runs. */
  | "implemented";

/** A callback, resolved through base-hook delegation. */
export interface CallbackBinding {
  readonly spec: CallbackSpec;
  readonly status: CallbackStatus;
  /** The external function the pool manager calls. */
  readonly entry: AstNode | undefined;
  /** The function whose body holds the logic (may equal `entry`). */
  readonly impl: AstNode | undefined;
  /** Every function traversed from `entry` to `impl`, inclusive. */
  readonly path: readonly AstNode[];
}

/** A contract the linter recognises as a hook. */
export interface HookContract {
  readonly ref: ContractRef;
  /** C3 linearization, most-derived first. */
  readonly chain: readonly AstNode[];
  readonly dialect: HookDialect;
  readonly poolType: PoolType;
  readonly isAbstract: boolean;
  /** The permission-declaring view, if the contract has a concrete one. */
  readonly permissionFn: AstNode | undefined;
  /** The expression the permission view returns, for pointing at in a report. */
  readonly permissionExpression: AstNode | undefined;
  /**
   * The declared permission bitmap, when it could be evaluated statically.
   * `undefined` means "do not guess" - dependent rules stand down.
   */
  readonly declaredBitmap: number | undefined;
  readonly callbacks: ReadonlyMap<string, CallbackBinding>;
}

function isRevertStatement(statement: AstNode): boolean {
  if (statement.nodeType === "RevertStatement") return true;
  if (statement.nodeType !== "ExpressionStatement") return false;
  const expression = getNode(statement, "expression");
  if (expression?.nodeType !== "FunctionCall") return false;
  const name = getString(getNode(expression, "expression"), "name");
  return name === "revert";
}

/** True when the body cannot complete normally: every statement aborts. */
export function isRevertOnly(body: AstNode | undefined): boolean {
  if (body === undefined) return false;
  const statements = getNodes(body, "statements");
  if (statements.length === 0) return false;
  return statements.every(isRevertStatement);
}

/**
 * Name of the internal function a one-line body forwards to.
 *
 * Only a body that does nothing *but* forward counts; anything else is the
 * implementation itself and must be analysed where it stands.
 */
function delegationTarget(compilation: Compilation, body: AstNode | undefined): string | undefined {
  if (body === undefined) return undefined;
  const statements = getNodes(body, "statements");
  if (statements.length !== 1) return undefined;
  const statement = statements[0];
  if (statement === undefined) return undefined;

  let expression: AstNode | undefined;
  if (statement.nodeType === "Return") expression = getNode(statement, "expression");
  else if (statement.nodeType === "ExpressionStatement") expression = getNode(statement, "expression");
  if (expression?.nodeType !== "FunctionCall") return undefined;
  if (getString(expression, "kind") !== "functionCall") return undefined;

  const target = getNode(expression, "expression");
  if (target?.nodeType !== "Identifier") return undefined;
  const declId = referencedDeclaration(target);
  if (declId === undefined) return undefined;
  const decl = compilation.nodesById.get(declId);
  if (decl?.nodeType !== "FunctionDefinition") return undefined;
  const visibility = getString(decl, "visibility");
  if (visibility !== "internal" && visibility !== "private") return undefined;
  return getString(decl, "name");
}

function resolveCallback(
  compilation: Compilation,
  chain: readonly AstNode[],
  spec: CallbackSpec,
): CallbackBinding {
  const entry = resolveVirtual(chain, spec.name);
  if (entry === undefined) {
    return { spec, status: "absent", entry: undefined, impl: undefined, path: [] };
  }

  const path: AstNode[] = [entry];
  let current = entry;
  const seen = new Set<string>([spec.name]);

  for (let depth = 0; depth < 6; depth++) {
    const body = getNode(current, "body");
    if (isRevertOnly(body)) {
      return { spec, status: "not-implemented", entry, impl: current, path };
    }
    const next = delegationTarget(compilation, body);
    if (next === undefined || seen.has(next)) break;
    const resolved = resolveVirtual(chain, next);
    if (resolved === undefined) break;
    seen.add(next);
    current = resolved;
    path.push(current);
  }

  return { spec, status: "implemented", entry, impl: current, path };
}

/** Extracts the bitmap from a Latch-style `getHooksRegistrationBitmap()`. */
function evaluateLatchBitmap(
  compilation: Compilation,
  fn: AstNode,
): { bitmap: number | undefined; expression: AstNode | undefined } {
  const body = getNode(fn, "body");
  if (body === undefined) return { bitmap: undefined, expression: undefined };
  const returns = collect(body, "Return");
  if (returns.length !== 1) return { bitmap: undefined, expression: undefined };
  const expression = getNode(returns[0], "expression");
  const folded = foldConstant(expression, (id) => compilation.nodesById.get(id));
  if (folded === undefined || folded < 0n || folded > 0xffffn) {
    return { bitmap: undefined, expression };
  }
  return { bitmap: Number(folded), expression };
}

/** Extracts an equivalent bitmap from a Uniswap v4 `getHookPermissions()`. */
function evaluateV4Permissions(fn: AstNode): {
  bitmap: number | undefined;
  expression: AstNode | undefined;
} {
  const body = getNode(fn, "body");
  if (body === undefined) return { bitmap: undefined, expression: undefined };
  const returns = collect(body, "Return");
  if (returns.length !== 1) return { bitmap: undefined, expression: undefined };
  const expression = getNode(returns[0], "expression");
  if (expression?.nodeType !== "FunctionCall") return { bitmap: undefined, expression };

  const names = expression["names"];
  const args = getNodes(expression, "arguments");
  if (!Array.isArray(names) || names.length !== args.length || names.length === 0) {
    return { bitmap: undefined, expression };
  }

  let bitmap = 0;
  for (let i = 0; i < names.length; i++) {
    const field = names[i];
    if (typeof field !== "string") return { bitmap: undefined, expression };
    const bit = V4_PERMISSION_FIELD_BITS[field];
    if (bit === undefined) continue;
    const value = args[i];
    if (value?.nodeType !== "Literal") return { bitmap: undefined, expression };
    if (getString(value, "value") === "true") bitmap |= 1 << bit;
  }
  return { bitmap, expression };
}

function detectPoolType(chain: readonly AstNode[]): PoolType {
  const names = new Set(functionsInChain(chain).map((fn) => getString(fn, "name")));
  if (names.has("beforeMint") || names.has("afterBurn") || names.has("beforeBurn")) return "BIN";
  return "CL";
}

/** Builds the hook model for a contract, or `undefined` when it is not a hook. */
export function asHookContract(compilation: Compilation, ref: ContractRef): HookContract | undefined {
  if (ref.kind !== "contract") return undefined;
  const chain = linearizedChain(compilation, ref.node);

  const latchFn = resolveVirtual(chain, LATCH_BITMAP_FUNCTION);
  const v4Fn = resolveVirtual(chain, V4_PERMISSIONS_FUNCTION);
  const declaresPermissionView =
    latchFn !== undefined ||
    v4Fn !== undefined ||
    functionsInChain(chain).some(
      (fn) =>
        getString(fn, "name") === LATCH_BITMAP_FUNCTION || getString(fn, "name") === V4_PERMISSIONS_FUNCTION,
    );

  const implementsCallback = functionsInChain(chain).some((fn) => {
    const name = getString(fn, "name");
    if (name === undefined || !ALL_CALLBACK_NAMES.has(name)) return false;
    const visibility = getString(fn, "visibility");
    return (visibility === "external" || visibility === "public") && isImplemented(fn);
  });

  if (!declaresPermissionView && !implementsCallback) return undefined;

  const dialect: HookDialect = v4Fn !== undefined && latchFn === undefined ? "uniswap-v4" : "latch";
  const poolType = detectPoolType(chain);

  const permissionFn = dialect === "uniswap-v4" ? v4Fn : latchFn;
  const evaluated =
    permissionFn === undefined
      ? { bitmap: undefined, expression: undefined }
      : dialect === "uniswap-v4"
        ? evaluateV4Permissions(permissionFn)
        : evaluateLatchBitmap(compilation, permissionFn);

  const callbacks = new Map<string, CallbackBinding>();
  for (const spec of callbackFunctions(poolType)) {
    callbacks.set(spec.name, resolveCallback(compilation, chain, spec));
  }

  return {
    ref,
    chain,
    dialect,
    poolType,
    isAbstract: getBoolean(ref.node, "abstract") === true,
    permissionFn,
    permissionExpression: evaluated.expression,
    declaredBitmap: evaluated.bitmap,
    callbacks,
  };
}

/** Every hook contract in the compilation. */
export function findHookContracts(compilation: Compilation): HookContract[] {
  const out: HookContract[] = [];
  for (const ref of allContracts(compilation)) {
    const hook = asHookContract(compilation, ref);
    if (hook !== undefined) out.push(hook);
  }
  return out;
}

/** Name of the `sender` parameter of a callback, or `undefined` when unnamed. */
export function senderParameter(fn: AstNode | undefined): AstNode | undefined {
  const params = getNodes(getNode(fn, "parameters"), "parameters");
  const first = params[0];
  if (first === undefined) return undefined;
  const name = getString(first, "name");
  if (name === undefined || name.length === 0) return undefined;
  const type = typeStringOf(first);
  if (type !== "address") return undefined;
  return first;
}

/** Modifier invocations attached to a function. */
export function modifierInvocations(fn: AstNode | undefined): AstNode[] {
  return getNodes(fn, "modifiers");
}

/** All functions declared directly on the most-derived contract. */
export function ownFunctions(hook: HookContract): AstNode[] {
  return membersOf(hook.ref.node, "FunctionDefinition");
}
