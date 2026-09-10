// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

import { createLatchTools } from "../src/toolset.js";
import { toOpenAiTools, runOpenAiToolCall } from "../src/adapters/openai.js";
import { toAnthropicTools, runAnthropicToolUse } from "../src/adapters/anthropic.js";
import { toMcpTools, runMcpToolCall } from "../src/adapters/mcp.js";
import { toJson, NotJsonSerialisable } from "../src/json.js";
import { fakeClient } from "./helpers.js";

const client = fakeClient({});

describe("default toolset", () => {
  it("is read-only and contains no tool that can send a transaction", () => {
    const t = createLatchTools({ publicClient: client });
    expect(t.isReadOnly).toBe(true);
    expect(t.tools.every((x) => x.access === "read")).toBe(true);
    expect(t.names).toEqual([
      "protocol_status",
      "latch_lookup",
      "latch_list",
      "latch_explain_permissions",
      "latch_assess_risk",
    ]);
  });

  it("does not build the maintenance tool unless it is explicitly enabled", () => {
    const off = createLatchTools({ publicClient: client });
    expect(off.get("latch_maintenance")).toBeUndefined();

    const on = createLatchTools({
      publicClient: client,
      maintenance: { enabled: true },
    });
    expect(on.get("latch_maintenance")).toBeDefined();
    // Enabled but still simulate-only by default: turning it on is not the
    // same decision as letting it broadcast.
    expect(on.get("latch_maintenance")?.access).toBe("simulate");
    expect(on.isReadOnly).toBe(false);

    const sending = createLatchTools({
      publicClient: client,
      maintenance: { enabled: true, mode: "send" },
    });
    expect(sending.get("latch_maintenance")?.access).toBe("write");
  });

  it("readOnly() strips anything that is not a plain read", () => {
    const t = createLatchTools({
      publicClient: client,
      maintenance: { enabled: true, mode: "send" },
    });
    expect(t.readOnly().get("latch_maintenance")).toBeUndefined();
    expect(t.readOnly().isReadOnly).toBe(true);
  });

  it("rejects an unsupported chain rather than guessing an address", () => {
    expect(() => createLatchTools({ chainId: 8453 })).toThrow(/no known deployment/i);
  });
});

describe("tool definitions", () => {
  const toolset = createLatchTools({
    publicClient: client,
    maintenance: { enabled: true },
  });

  it("gives every tool a stable snake_case name and a real description", () => {
    for (const tool of toolset.tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      // Long enough to route on. A one-line description is where an agent
      // picks the wrong tool.
      expect(tool.description.length).toBeGreaterThan(200);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("declares every required property in its own schema", () => {
    for (const tool of toolset.tools) {
      for (const required of tool.inputSchema.required ?? []) {
        expect(Object.keys(tool.inputSchema.properties)).toContain(required);
      }
    }
  });

  it("tells the model what each tool cannot answer, not only what it can", () => {
    const lookup = toolset.get("latch_lookup");
    expect(lookup?.description).toContain("not an endorsement");
    const risk = toolset.get("latch_assess_risk");
    expect(risk?.description).toContain("never returns a verdict of 'safe'");
    const perms = toolset.get("latch_explain_permissions");
    expect(perms?.description).toContain("MAY do, not what it does");
  });

  it("names the boundary in the maintenance tool's own description", () => {
    const m = toolset.get("latch_maintenance");
    expect(m?.description).toContain("permissionless");
    expect(m?.description).toContain("cannot call any owner-, curator- or guardian-only function");
  });

  it("marks the tools that can carry submitter-authored text", () => {
    expect(toolset.get("latch_lookup")?.returnsUntrustedText).toBe(true);
    expect(toolset.get("latch_list")?.returnsUntrustedText).toBe(true);
    expect(toolset.get("protocol_status")?.returnsUntrustedText).toBe(false);
    expect(toolset.get("latch_explain_permissions")?.returnsUntrustedText).toBe(false);
  });
});

describe("dispatch", () => {
  const toolset = createLatchTools({ publicClient: client });

  it("answers an unknown tool name with the list of real ones", async () => {
    const r = await toolset.call("latch_do_the_thing", {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("invalid_input");
    expect(r.error.message).toContain("latch_lookup");
  });

  it("returns an error result rather than throwing on bad input", async () => {
    const r = await toolset.call("latch_explain_permissions", { bitmap: "banana" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("invalid_input");
  });

  it("accepts a bitmap as hex or decimal", async () => {
    const hex = await toolset.call("latch_explain_permissions", { bitmap: "0x0040" });
    const dec = await toolset.call("latch_explain_permissions", { bitmap: 64 });
    expect(hex.ok && dec.ok).toBe(true);
    if (!hex.ok || !dec.ok) return;
    expect(hex.data).toEqual(dec.data);
  });

  it("refuses the maintenance tool when it was never enabled", async () => {
    // Reached only by hand-assembling a toolset; the second gate behind the
    // first, which is that the tool is not built at all.
    const { maintenanceTool } = await import("../src/tools/maintenance.js");
    const { createContext } = await import("../src/context.js");
    const tool = maintenanceTool(createContext({ publicClient: client }));
    const r = await tool.handler({ action: "closeEpoch" } as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("not_enabled");
  });
});

describe("adapters", () => {
  const toolset = createLatchTools({
    publicClient: client,
    maintenance: { enabled: true, mode: "send" },
  });

  it("produces the OpenAI function shape", () => {
    const tools = toOpenAiTools(toolset);
    expect(tools).toHaveLength(6);
    expect(tools[0]?.type).toBe("function");
    expect(tools[0]?.function.name).toBe("protocol_status");
    expect(tools[0]?.function.parameters).toHaveProperty("type", "object");
  });

  it("produces the Anthropic tool shape with input_schema at the top level", () => {
    const tools = toAnthropicTools(toolset);
    expect(tools[1]?.name).toBe("latch_lookup");
    expect(tools[1]?.input_schema).toHaveProperty("properties");
    expect(tools[1]).not.toHaveProperty("function");
  });

  it("derives MCP annotations from access rather than restating them", () => {
    const byName = new Map(toMcpTools(toolset).map((t) => [t.name, t]));
    expect(byName.get("latch_lookup")?.annotations.readOnlyHint).toBe(true);
    // The one tool that can broadcast must not be advertised as read-only.
    expect(byName.get("latch_maintenance")?.annotations.readOnlyHint).toBe(false);
  });

  it("hands a model back a readable complaint about malformed arguments", async () => {
    const text = await runOpenAiToolCall(toolset, {
      name: "latch_explain_permissions",
      arguments: "{not json",
    });
    const parsed = JSON.parse(text) as { ok: boolean; error: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("invalid_input");
  });

  it("marks a failed call as an error in both block-based adapters", async () => {
    const anthropic = await runAnthropicToolUse(toolset, {
      id: "toolu_1",
      name: "latch_lookup",
      input: { address: "nope" },
    });
    expect(anthropic.is_error).toBe(true);
    expect(anthropic.tool_use_id).toBe("toolu_1");

    const mcp = await runMcpToolCall(toolset, "latch_lookup", { address: "nope" });
    expect(mcp.isError).toBe(true);
    expect(mcp.content[0]?.type).toBe("text");
  });
});

describe("toJson", () => {
  it("refuses a bigint instead of letting JSON.stringify throw in someone else's code", () => {
    expect(() => toJson({ block: 1n })).toThrow(NotJsonSerialisable);
  });

  it("drops undefined properties but keeps array positions", () => {
    expect(toJson({ a: 1, b: undefined })).toEqual({ a: 1 });
    expect(toJson([1, undefined, 3])).toEqual([1, null, 3]);
  });

  it("refuses a class instance rather than serialising it to an empty object", () => {
    expect(() => toJson(new Date())).toThrow(NotJsonSerialisable);
  });
});
