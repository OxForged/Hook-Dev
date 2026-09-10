// SPDX-License-Identifier: MIT
/**
 * Model Context Protocol shapes.
 *
 * MCP is the one adapter here that is worth more than a field rename: it is a
 * transport-level standard, so a host that speaks it can pick these tools up
 * without knowing anything about Latch, TypeScript or this package.
 *
 * Still no dependency. `@modelcontextprotocol/sdk` is not imported and is not a
 * peer dependency - {@link toMcpTools} produces the `tools/list` payload and
 * {@link runMcpToolCall} produces the `tools/call` result, and you wire them to
 * whichever server implementation you already run. Ten lines of glue against a
 * stable protocol beats a dependency that has to track its SDK's releases.
 *
 * ## `isError`
 *
 * MCP distinguishes a protocol error (the call could not be made) from a tool
 * error (the call was made and reports a failure). Everything here is the
 * second kind: "not registered", "RPC unreachable" and "not due yet" are all
 * answers, so they come back as content with `isError: true` rather than as a
 * JSON-RPC error, and the model gets to read them.
 */

import type { LatchToolset } from "../toolset.js";
import type { LatchTool } from "../types.js";

/** An entry in an MCP `tools/list` response. */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /**
   * MCP behaviour hints. These are advisory - a host may show them to a user
   * before approving a call - and they are filled from the tool's own `access`,
   * so a tool that can broadcast cannot be described as read-only by accident.
   */
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    /** Every call in this package is idempotent in the sense that matters: it
     * re-reads chain state, and a repeated maintenance call is a no-op that
     * reverts rather than a second effect. */
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
  };
}

export function toMcpTool(tool: LatchTool): McpToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
    annotations: {
      readOnlyHint: tool.access === "read",
      // No tool here can destroy or move a user's asset. The maintenance tool
      // changes protocol state, so it is not read-only, but every call it can
      // make is permissionless and cannot direct value to its caller.
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  };
}

export function toMcpTools(toolset: LatchToolset): McpToolDescriptor[] {
  return toolset.tools.map(toMcpTool);
}

/** An MCP `tools/call` result. */
export interface McpCallResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError: boolean;
}

export async function runMcpToolCall(
  toolset: LatchToolset,
  name: string,
  args: unknown,
): Promise<McpCallResult> {
  const result = await toolset.call(name, args);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}
