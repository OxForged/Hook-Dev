// SPDX-License-Identifier: MIT
/**
 * Anthropic Messages API tool definitions.
 *
 * Same idea as the OpenAI adapter and the same discipline: no SDK import, no
 * borrowed types, just the JSON the Messages API accepts. The only structural
 * difference is that the schema field is `input_schema` and lives at the top
 * level rather than nested under `function`.
 */

import type { LatchToolset } from "../toolset.js";
import type { LatchTool, ToolResult } from "../types.js";

/** The `tools[]` entry shape for the Anthropic Messages API. */
export interface AnthropicTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

export function toAnthropicTool(tool: LatchTool): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as unknown as Record<string, unknown>,
  };
}

export function toAnthropicTools(toolset: LatchToolset): AnthropicTool[] {
  return toolset.tools.map(toAnthropicTool);
}

/** A `tool_result` content block, ready to send back in a user turn. */
export interface AnthropicToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string;
  /** Set when the tool reported a failure, so the model is not left inferring
   * it from the JSON body. */
  readonly is_error?: boolean;
}

/**
 * Execute one `tool_use` block and build its `tool_result`.
 *
 * `is_error` is set from the result envelope rather than from a thrown
 * exception, because a tool failing is normal traffic here: "not registered",
 * "RPC unreachable" and "not due yet" are all answers a model must be able to
 * read and act on.
 */
export async function runAnthropicToolUse(
  toolset: LatchToolset,
  block: { readonly id: string; readonly name: string; readonly input: unknown },
): Promise<AnthropicToolResultBlock> {
  const result: ToolResult = await toolset.call(block.name, block.input);
  return result.ok
    ? { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) }
    : {
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: true,
      };
}
