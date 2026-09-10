import { describe, expect, it } from "vitest";
import { CALLBACKS } from "../src/codegen/callbacks.js";
import {
  renderDeployScript,
  renderFoundryToml,
  renderHook,
  renderLatchConfig,
  renderReadme,
  renderTest,
  tickRange,
  type ProjectContext,
} from "../src/codegen/project.js";
import {
  ALL_PERMISSIONS,
  poolParametersFor,
  resolvePermissions,
  RETURNS_DELTA_PERMISSIONS,
  type PermissionName,
} from "../src/permissions.js";
import { findTemplate, TEMPLATES } from "../src/templates/index.js";

function contextFor(
  permissions: readonly PermissionName[],
  templateId = "noop",
  tickSpacing = 60,
): ProjectContext {
  const template = findTemplate(templateId);
  if (template === undefined) throw new Error(`no template ${templateId}`);
  const resolved = resolvePermissions(permissions);
  const templateApplies = template.requires.every((name) => resolved.names.includes(name));
  return {
    projectName: "my-hook",
    contractName: "MyHook",
    template,
    permissions: resolved,
    tickSpacing,
    lpFee: templateApplies && template.dynamicFee ? undefined : 3000,
    parameters: poolParametersFor(resolved.bitmap, tickSpacing),
    templateApplies,
    cliVersion: "0.0.0-test",
    paths: { core: "../core", hooks: "../hooks" },
  };
}

describe("renderHook", () => {
  it("registers exactly what it implements", () => {
    for (const template of TEMPLATES) {
      const ctx = contextFor(template.defaultPermissions, template.id);
      const hook = renderHook(ctx);

      for (const name of ctx.permissions.names) {
        const spec = CALLBACKS[name];
        if (spec === undefined) {
          expect(RETURNS_DELTA_PERMISSIONS.has(name), `${name} should be a flag-only permission`).toBe(true);
          continue;
        }
        expect(hook, `${template.id} is missing ${spec.fn}`).toContain(`function ${spec.fn}(`);
      }

      // ...and nothing it does not register, because BaseCLHook's unimplemented
      // override points revert.
      for (const name of ALL_PERMISSIONS) {
        if (ctx.permissions.names.includes(name)) continue;
        const spec = CALLBACKS[name];
        if (spec === undefined) continue;
        expect(hook, `${template.id} implements unregistered ${spec.fn}`).not.toContain(
          `function ${spec.fn}(`,
        );
      }
    }
  });

  it("puts the generated bitmap expression in getHooksRegistrationBitmap", () => {
    const ctx = contextFor(["beforeSwap", "afterSwap"]);
    expect(renderHook(ctx)).toContain("return BEFORE_SWAP | AFTER_SWAP;");
  });

  it("documents the parameters word that must accompany it", () => {
    const ctx = contextFor(["beforeSwap"]);
    expect(renderHook(ctx)).toContain(ctx.parameters);
  });

  it("parenthesises a single return type", () => {
    const ctx = contextFor(["beforeInitialize"]);
    expect(renderHook(ctx)).toContain("returns (bytes4)");
    expect(renderHook(ctx)).not.toContain("returns bytes4");
  });

  it("leaves unread parameters unnamed so the build stays warning-free", () => {
    const ctx = contextFor(["beforeSwap"]);
    expect(renderHook(ctx)).toContain(
      "function _beforeSwap(address, PoolKey calldata, ICLPoolManager.SwapParams calldata, bytes calldata)",
    );
  });

  it("names the parameters a template body actually reads", () => {
    const ctx = contextFor(["afterSwap"], "swap-counter");
    expect(renderHook(ctx)).toContain("PoolKey calldata key");
    expect(renderHook(ctx)).toContain("key.toId()");
  });

  it("only imports the types it uses", () => {
    const hook = renderHook(contextFor(["beforeInitialize"]));
    expect(hook).toContain("PoolKey.sol");
    expect(hook).not.toContain("BalanceDelta.sol");
  });

  it("falls back to pass-throughs when a template's callback was deselected", () => {
    // swap-counter implements afterSwap; ask for beforeSwap only.
    const ctx = contextFor(["beforeSwap"], "swap-counter");
    expect(ctx.templateApplies).toBe(false);
    const hook = renderHook(ctx);
    expect(hook).not.toContain("swapCount");
    expect(hook).toContain("_passthroughSwap()");
  });
});

describe("renderTest", () => {
  it("asserts the two values that must never drift", () => {
    const ctx = contextFor(["beforeSwap"]);
    const test = renderTest(ctx);
    expect(test).toContain(`uint16 internal constant EXPECTED_BITMAP = ${ctx.permissions.bitmapHex};`);
    expect(test).toContain(`bytes32 internal constant EXPECTED_PARAMETERS = ${ctx.parameters};`);
    expect(test).toContain("function test_registrationBitmapMatchesPoolKey()");
    expect(test).toContain("function test_mismatchedBitmapRevertsAtInitialize()");
  });

  it("keeps the position range a multiple of the tick spacing", () => {
    for (const tickSpacing of [1, 10, 60, 200, 32767]) {
      const range = tickRange(tickSpacing);
      expect(range.upper % tickSpacing).toBe(0);
      expect(range.lower).toBe(-range.upper);
      expect(range.upper).toBeGreaterThan(0);
    }
  });

  it("uses a dynamic fee only when the template asks for one", () => {
    expect(renderTest(contextFor(["beforeSwap"], "dynamic-fee"))).toContain(
      "LP_FEE = LPFeeLibrary.DYNAMIC_FEE_FLAG",
    );
    expect(renderTest(contextFor(["beforeSwap"], "noop"))).toContain("LP_FEE = uint24(3000)");
  });
});

describe("renderFoundryToml", () => {
  const toml = renderFoundryToml(contextFor(["beforeSwap"]));

  it("pins hp-transient per profile, not once", () => {
    expect(toml).toContain("hp-transient/=../core/src/libraries/transient/eip1153/");
    expect(toml).toContain("hp-transient/=../core/src/libraries/transient/storage/");
  });

  it("gives the legacy profile a shanghai target and its own out dir", () => {
    const legacy = toml.slice(toml.indexOf("[profile.legacy]"));
    expect(legacy).toContain('evm_version = "shanghai"');
    expect(legacy).toContain('out = "foundry-out-legacy"');
  });

  it("does not let forge go looking for libraries to install", () => {
    expect(toml).toContain("libs = []");
  });
});

describe("renderDeployScript", () => {
  it("re-derives the parameters word from the deployed hook", () => {
    const script = renderDeployScript(contextFor(["beforeSwap"]));
    expect(script).toContain("hook.getHooksRegistrationBitmap()");
    expect(script).toContain("CLPoolParametersHelper.setTickSpacing");
    expect(script).toContain('require(onChainBitmap == EXPECTED_BITMAP');
  });

  it("passes a template's extra constructor arguments through", () => {
    const script = renderDeployScript(contextFor(["beforeSwap"], "dynamic-fee"));
    expect(script).toContain('vm.envOr("LARGE_SWAP_THRESHOLD"');
  });
});

describe("renderLatchConfig / renderReadme", () => {
  it("records the same numbers the Solidity carries", () => {
    const ctx = contextFor(["beforeSwap", "afterSwap"]);
    const config = JSON.parse(renderLatchConfig(ctx)) as {
      permissions: { bitmap: number; bitmapHex: string };
      poolKey: { parameters: string };
    };
    expect(config.permissions.bitmap).toBe(ctx.permissions.bitmap);
    expect(config.poolKey.parameters).toBe(ctx.parameters);
    expect(renderReadme(ctx)).toContain(ctx.parameters);
  });

  it("calls out permissions that were added for a delta flag", () => {
    const ctx = contextFor(["afterSwapReturnsDelta"]);
    expect(renderReadme(ctx)).toContain("Added automatically");
  });
});

describe("every permission combination renders something plausible", () => {
  it("emits one override per callback permission and none for the flags", () => {
    for (const name of ALL_PERMISSIONS) {
      const ctx = contextFor([name]);
      const hook = renderHook(ctx);
      const overrides = [...hook.matchAll(/function _\w+\(/g)].length;
      const expected = ctx.permissions.names.filter((n) => CALLBACKS[n] !== undefined).length;
      expect(overrides, `${name} produced ${overrides} overrides, expected ${expected}`).toBe(expected);
    }
  });
});
