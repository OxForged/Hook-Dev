# @latchprotocol/latch-ai

**LatchAI** — the plugin that lets an AI agent understand and use Latch Protocol.

It is not an agent. It is a set of typed, documented capabilities an agent can call, plus thin adapters that reshape them for the runtime you already use.

## Why a plugin and not a framework

We deliberately did not fork an agent framework. Forking one means inheriting a maintenance surface that is not our differentiator, and cutting ourselves off from the plugin ecosystem that makes those frameworks worth using in the first place.

So this package has **zero dependency on any LLM SDK or agent framework**. No ElizaOS, no LangChain, no OpenAI, no Anthropic. It depends on `@latchprotocol/sdk` and `viem`, and nothing else. It is usable from all of them precisely because it depends on none of them.

There is no loop, no planner, no memory, no prompt and no model in this package.

## The tools

| tool | access | what it answers |
|---|---|---|
| `protocol_status` | read | Where the deployment is, what block, which contracts, fee settings and their cap, timelock delays, listing count, pool count. |
| `latch_lookup` | read | One address: its registry record, curation status, and what its permission bitmap allows. |
| `latch_list` | read | Enumerate and filter the registry by risk class, verification level, listing state, or a text match. |
| `latch_explain_permissions` | read | Turn a `uint16` permission bitmap into plain language. Pure — no network, no chain. |
| `latch_assess_risk` | read | A structured trust summary: the three axes, severity-ordered warnings, and what the assessment does not cover. |
| `latch_maintenance` | **opt-in** | Run one of the four permissionless maintenance calls, or check whether it is due. **Off by default.** |

```ts
import { createLatchTools } from "@latchprotocol/latch-ai";
import { toAnthropicTools } from "@latchprotocol/latch-ai/adapters/anthropic";

const latch = createLatchTools();        // Sepolia, read-only, no key read
const tools = toAnthropicTools(latch);   // hand to your model

const result = await latch.call("latch_lookup", { address });
```

## What is deliberately withheld

`latch_maintenance` can call exactly four functions:

```
closeEpoch()   rollover(epochId)   settleBeneficiaries(key, currency)   applyPendingConfig(key)
```

All four are **permissionless on chain** — any address may call them from anywhere, and none of them can direct value to the caller. They are the calls that must happen for revenue to keep moving; an epoch that never closes is an epoch nobody can claim from. They are the same four `@latchprotocol/keeper` makes.

**Not exposed, and never to be added:**

- anything `onlyOwner`, `onlyCurator`, `onlyGuardian`, or otherwise privileged;
- anything that moves a user's funds — no swap, no add or remove liquidity, no claim, no approve, no transfer;
- anything on the registry — no `register`, no `setVerification`, no `setListing`;
- anything on the Vault, including `registerApp`, which is **irreversible**.

If a future capability needs a privileged role, it does not belong in a package an LLM drives. That is not a policy about this version — it is the reason the package can be given a key at all.

`src/abi.ts` is the complete list of calls this package is capable of making. It is deliberately hand-written and narrow: if a function is not in that file, this package cannot reach it, whatever a model asks for.

### What a stolen `LATCH_AI_PRIVATE_KEY` buys an attacker

**Nothing they could not already do from any address.** They can close an epoch slightly earlier than you would have, or waste the key's gas. They cannot move funds, change a fee, alter a roster, or touch a listing. Use a dedicated address holding only gas.

### Three gates before anything is broadcast

1. `maintenance: { enabled: true }` at construction — otherwise the tool is not built at all.
2. `mode: "send"` — otherwise every call is a simulation that reports what *would* happen.
3. The key is present in the environment — otherwise every call is a simulation.

```ts
// Reports whether each call is due. Reads no key, sends nothing.
createLatchTools({ maintenance: { enabled: true } });

// Can broadcast — and only if LATCH_AI_PRIVATE_KEY is also set.
createLatchTools({ maintenance: { enabled: true, mode: "send" } });
```

And on every call, whatever the gates say: the on-chain preconditions are read first, the call is **simulated**, and a broadcast happens only if the simulation succeeded and the estimated gas is under `maxGas`. Every contract-side guard (`EpochTooSoon`, `NothingToDistribute`, `AlreadyRolledOver`, `ClaimWindowClosed`) is a revert, so simulating turns all of them into free reads — and a revert reads as *"not due"*, which is the normal state most of the time.

`settleBeneficiaries` needs extra care and gets it: it does **not** revert when it is pointless — it returns early on a zero pot or an empty roster — so the tool reads `pendingBeneficiary` first. A simulation that "succeeds" by doing nothing is not a reason to spend gas.

`LatchToolset.readOnly()` strips anything that is not a plain read, independently of how the toolset was constructed.

## The rules the output obeys

### It never says "safe"

`latch_assess_risk` has no positive verdict, no score, and no green state, and it cannot be made to produce one. Nothing it can read is capable of establishing safety: the registry is a permissionless, free listing curated by humans, and a permission bitmap is a statement about *capability*. An agent that reads "this Latch is safe" and routes a user's funds accordingly is exactly the failure this package is designed against.

Note the test for this matches the *assertion*, not the word — `"this is not a safety verdict"` is an honest sentence and stays allowed.

### It never collapses the three axes

`Verification` (what a human attested), `Listing` (whether the registry still recommends it) and `RiskClass` (what the code can do) move independently and are reported side by side. A hook can be genuinely `Audited` and also `ValueExtracting` — a fee hook doing exactly what it says. Collapsing that into one number is how a green tick ends up next to a contract that drains the pool.

### "Not registered" is a result, not an empty record

`latch_lookup` returns three visibly different answers, and a fourth that is not an answer at all:

| result | meaning |
|---|---|
| `registered: true` | the registry holds a record |
| `registered: false, hasCode: true` | a real contract nobody has listed |
| `registered: false, hasCode: false` | no code here — a wallet, or the wrong chain |
| `ok: false, error.code: "rpc_unavailable"` | the chain could not be reached — **not** an absence |

An unregistered address never comes back as a record with blank fields. The registry contract enforces this by making `getLatch` *revert* rather than return a zeroed struct, because a zeroed struct decodes to "Unverified, Active, no permissions" — the most reassuring possible description of a contract nobody has ever looked at.

The fourth row matters just as much: an unreachable RPC and an unlisted hook are opposite answers, and conflating them is how an agent concludes a contract is unlisted because a public endpoint rate-limited it.

### Every result carries its own limits

`caveats` is a required field on the result envelope, not a footnote a caller can forget to render. Same for `doesNotCover` on an assessment, and `null` rather than `0` when a figure genuinely could not be read — `poolCount: null` means the RPC would not serve the log range, and reporting zero there would be a fabrication.

### Submitter-authored text is quarantined

Registry metadata — name, description, source URI — is written by whoever submitted the listing. Fed into an LLM it is attacker-controlled text arriving inside a trusted-looking tool result: a prompt-injection carrier.

Every such string lives under an `untrusted` key and nowhere else, is stripped of control characters (C0/C1, zero-width, bidi overrides, the Unicode tag block), has its whitespace collapsed so it cannot fake a message boundary, is truncated, and is labelled in the caveats. Tools that can carry it are marked `returnsUntrustedText: true` so a host can gate on it.

This does not *detect* injection — that is not a solvable string problem. It shrinks the surface and labels the rest.

## Adapters

Each adapter is a separate optional export and imports nothing. They produce the plain JSON object each API accepts, so there is no SDK version to track.

```ts
import { toOpenAiTools, runOpenAiToolCall }       from "@latchprotocol/latch-ai/adapters/openai";
import { toAnthropicTools, runAnthropicToolUse }  from "@latchprotocol/latch-ai/adapters/anthropic";
import { toMcpTools, runMcpToolCall }             from "@latchprotocol/latch-ai/adapters/mcp";
```

- **openai** — the `tools[]` shape most runtimes converged on: OpenAI Chat Completions and Responses, and by extension LangChain, LlamaIndex, the Vercel AI SDK, and anything speaking an OpenAI-compatible endpoint. Try this one first.
- **anthropic** — the Messages API shape (`input_schema` at the top level), plus `tool_result` block construction with `is_error` set from the result envelope.
- **mcp** — `tools/list` descriptors with behaviour annotations derived from each tool's own `access` (so a tool that can broadcast cannot be advertised read-only), and `tools/call` results. Wire them to whichever MCP server implementation you already run; `@modelcontextprotocol/sdk` is not a dependency.

Anything else builds from `toolset.tools` directly — each tool is a name, a description, a JSON Schema and an async handler.

## Configuration

```ts
createLatchTools({
  chainId: 11155111,          // default; the only chain with a deployment
  rpcUrls: ["https://..."],   // optional; otherwise the SDK's probed list
  publicClient,               // optional; bring your own viem client
  maintenance: { enabled: false },
});
```

An unsupported chain **throws** rather than guessing an address. An agent told "no deployment on chain 8453" can act on that; an agent handed a plausible-looking wrong address cannot.

Private RPC endpoints come from the environment as `LATCH_RPC_<chainId>` (comma-separated for several), which the SDK's transport tries ahead of the public list. Never write a credentialed URL into code — see `CLAUDE.md`, "Secrets".

## Secrets

- The signing key is read from the environment and nowhere else. It is named via `privateKeyEnvVar`, never passed through an options object.
- It is never logged, never returned, never put in an error message, never written to disk. A malformed value is rejected without echoing it, not even a prefix.
- The default variable is `LATCH_AI_PRIVATE_KEY`, deliberately **not** the keeper's `KEEPER_PRIVATE_KEY`, so pointing an agent at a machine that runs a keeper does not hand it that keeper's key.

## Development

```bash
npm install
npm run typecheck     # tsc --noEmit, strict
npm test              # vitest
npm run build         # dist/
npm run live          # exercise the read tools against live Sepolia
```

Tests cover the pure logic — bitmap explanation, risk assessment, the not-registered-versus-empty distinction, error classification, adapter shapes — against a fake client, so they are deterministic and do not depend on a public endpoint.

## Licence

MIT. See `LICENSE`.

Independently authored, like `@latchprotocol/sdk`, and it stays on the MIT side of the GPL boundary: it contains no code copied from `packages/core`, `packages/periphery`, `packages/router` or `upstream/` (all GPL-2.0-or-later), and nothing from `upstream/infinity-hooks`, which carries no licence at all. Its knowledge of the contracts comes from the SDK's generated ABIs and from hand-written function signatures, never from the Solidity sources.

## Related

- `@latchprotocol/sdk` — the MIT SDK this is built on. All bitmap and registry semantics live there; this package reimplements none of them.
- `@latchprotocol/keeper` — the boring, reliable half. Every decision it makes is a comparison against on-chain state with an exact answer, so it needs no model. If you want the four maintenance calls to happen on a schedule, run the keeper; `latch_maintenance` exists for an agent that has a reason to make one now.
