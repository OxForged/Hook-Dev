// SPDX-License-Identifier: MIT
/**
 * The toolset: an immutable, name-indexed collection of {@link LatchTool}.
 *
 * It is deliberately not an agent. There is no loop, no planner, no memory, no
 * prompt and no model. A toolset is a value you hand to whatever runtime you
 * already use - which is the whole reason this package exists rather than a
 * fork of an agent framework: we would rather be usable from all of them than
 * be one of them.
 *
 * The one behaviour it does have is dispatch, and it is strict on purpose:
 * calling an unknown tool returns a structured error listing the tools that do
 * exist, because a model that mis-spells a tool name recovers from that and
 * cannot recover from a thrown exception it never sees.
 */

import { createContext, type LatchContext, type LatchToolsOptions } from "./context.js";
import { explainPermissionsTool } from "./tools/permissions.js";
import { listTool } from "./tools/list.js";
import { lookupTool } from "./tools/lookup.js";
import { maintenanceTool } from "./tools/maintenance.js";
import { assessRiskTool } from "./tools/risk.js";
import { protocolStatusTool } from "./tools/status.js";
import { err, type LatchTool, type ToolResult } from "./types.js";

export class LatchToolset {
  readonly #byName: ReadonlyMap<string, LatchTool>;

  /** The chain and clients these tools are bound to. Exposed for hosts that
   * want to reuse the same RPC client rather than open a second one. */
  readonly context: LatchContext;

  constructor(context: LatchContext, tools: readonly LatchTool[]) {
    this.context = context;
    const map = new Map<string, LatchTool>();
    for (const t of tools) {
      if (map.has(t.name)) throw new Error(`duplicate tool name: ${t.name}`);
      map.set(t.name, t);
    }
    this.#byName = map;
  }

  /** Every tool, in a stable order. */
  get tools(): readonly LatchTool[] {
    return [...this.#byName.values()];
  }

  get names(): readonly string[] {
    return [...this.#byName.keys()];
  }

  get(name: string): LatchTool | undefined {
    return this.#byName.get(name);
  }

  /**
   * The subset that cannot send a transaction.
   *
   * Useful as a belt-and-braces filter at the point a toolset is handed to a
   * model, independent of how it was constructed.
   */
  readOnly(): LatchToolset {
    return new LatchToolset(
      this.context,
      this.tools.filter((t) => t.access === "read"),
    );
  }

  /** True when nothing in this set can broadcast. */
  get isReadOnly(): boolean {
    return this.tools.every((t) => t.access === "read");
  }

  /**
   * Dispatch by name.
   *
   * Never throws: an unknown name, bad input and an unreachable RPC all come
   * back as a `ToolResult` so a tool-calling loop can feed the answer straight
   * back to the model.
   */
  async call(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.#byName.get(name);
    if (!tool) {
      return err(
        "invalid_input",
        `no such tool: ${JSON.stringify(name)}. Available: ${this.names.join(", ")}`,
      );
    }
    try {
      return await (tool.handler as (i: unknown) => Promise<ToolResult>)(input);
    } catch (e) {
      // A handler should classify its own failures; reaching here is a bug in
      // one, and the model still needs a result rather than a dropped call.
      return err("internal", e instanceof Error ? e.message : String(e));
    }
  }
}

/**
 * Build the toolset.
 *
 * With no arguments: Sepolia, read-only, five tools, no key read, nothing that
 * can send a transaction. Getting a sixth tool that can broadcast takes an
 * explicit `maintenance: { enabled: true, mode: "send" }` AND a key in the
 * environment - see `src/tools/maintenance.ts` for why that boundary is where
 * it is.
 */
export function createLatchTools(options: LatchToolsOptions = {}): LatchToolset {
  const ctx = createContext(options);

  const tools: LatchTool[] = [
    protocolStatusTool(ctx),
    lookupTool(ctx),
    listTool(ctx),
    explainPermissionsTool(),
    assessRiskTool(ctx),
  ];

  if (ctx.maintenance.enabled) tools.push(maintenanceTool(ctx));

  return new LatchToolset(ctx, tools);
}
