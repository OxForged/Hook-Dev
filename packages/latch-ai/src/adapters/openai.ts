// SPDX-License-Identifier: MIT
/**
 * OpenAI-style function/tool definitions.
 *
 * This is the shape most runtimes converged on - the OpenAI Chat Completions
 * and Responses APIs, and by extension LangChain, LlamaIndex, the Vercel AI SDK
 * and anything speaking an OpenAI-compatible endpoint. If a framework is not
 * listed here, try this adapter first.
 *
 * It imports nothing. There is no `openai` package in this file, no types
 * borrowed from one, and no version to keep up with - just the JSON object
 * those APIs accept. That is the entire point of shipping an adapter rather
 * than a framework integration: a plain object cannot go out of date.
 */

import type { LatchToolset } from "../toolset.js";
import type { LatchTool, ToolResult } from "../types.js";

/** The `tools[]` entry shape for OpenAI-compatible chat APIs. */
export interface OpenAiFunctionTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export function toOpenAiTool(tool: LatchTool): OpenAiFunctionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as unknown as Record<string, unknown>,
    },
  };
}

export function toOpenAiTools(toolset: LatchToolset): OpenAiFunctionTool[] {
  return toolset.tools.map(toOpenAiTool);
}

/**
 * Execute one tool call and return the string a `role: "tool"` message expects.
 *
 * Arguments arrive as a JSON string. A malformed one is answered with a tool
 * result rather than an exception: the model wrote it, the model can fix it,
 * and it can only do that if it sees the complaint.
 */
export async function runOpenAiToolCall(
  toolset: LatchToolset,
  call: { readonly name: string; readonly arguments: string },
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = call.arguments.trim() === "" ? {} : JSON.parse(call.arguments);
  } catch (e) {
    const result: ToolResult = {
      ok: false,
      error: {
        code: "invalid_input",
        message: `arguments were not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      },
      caveats: [],
    };
    return JSON.stringify(result);
  }
  return JSON.stringify(await toolset.call(call.name, parsed));
}
