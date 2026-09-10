// SPDX-License-Identifier: MIT
/** LATCH-011 - a bin hook that prices swaps but leaves the mint route free. */

import { hasHookPermission } from "@latchprotocol/sdk";
import { returnsFeeOverride } from "../analysis/fee.js";
import { BIN_HOOK_FLAGS } from "@latchprotocol/sdk";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

export const binCompositionFeeBypassRule: Rule = {
  id: "LATCH-011",
  title: "Bin hook prices swaps but not the mint composition swap",
  basis:
    "Source AST. The rule is a relationship between two callbacks - one returns a fee, the other is absent - which is a property of the hook as a whole rather than of any single function, and it only holds for BIN pools. Pool type is inferred from the callback set the contract inherits (`beforeMint`/`beforeBurn` rather than `beforeAddLiquidity`), so a CL hook is never asked the question.",

  run(context: RuleContext): FindingDraft[] {
    const { compilation, hook } = context;
    if (hook.poolType !== "BIN") return [];
    if (hook.isAbstract) return [];

    const swapFee = returnsFeeOverride(compilation, hook, "beforeSwap");
    if (!swapFee.returns) return [];

    const bitmap = hook.declaredBitmap;
    const declaresMint =
      bitmap === undefined ? undefined : hasHookPermission(bitmap, BIN_HOOK_FLAGS.beforeMint);
    const mintFee = returnsFeeOverride(compilation, hook, "beforeMint");
    if (declaresMint === true && mintFee.returns) return [];

    const gap =
      declaresMint === false
        ? "`beforeMint` (bit 2) is not registered at all"
        : hook.callbacks.get("beforeMint")?.status !== "implemented"
          ? "`beforeMint` has no implementation"
          : "`beforeMint` is implemented but returns no fee override";

    return [
      {
        severity: "high",
        confidence: "medium",
        at: swapFee.at ?? hook.permissionExpression ?? hook.permissionFn,
        message:
          `This bin hook enforces a fee through \`beforeSwap\`, but ${gap}. On a bin pool, adding liquidity ` +
          `to the ACTIVE bin at a ratio other than the bin's own performs an implicit swap inside core, ` +
          `priced by \`BinHelper.getCompositionFeesAmount\` from the pool's STORED LP fee - which on a ` +
          `dynamic-fee pool is 0 until \`updateDynamicLPFee\` is called. Mint lopsided, then burn, and you ` +
          `have swapped for free, straight past whatever \`beforeSwap\` was charging. The route also works ` +
          `while \`beforeSwap\` is reverting, so a swap gate does not close it either.\n\n` +
          `This is the exact shape of a line-for-line port of a CL hook to bin: on CL, adding liquidity ` +
          `cannot swap, so the CL version has no such hole and the omission looks harmless.`,
        fix:
          "Register `beforeMint` (bit 2) and return the same fee there that `beforeSwap` returns:\n\n" +
          "    function getHooksRegistrationBitmap() public pure override returns (uint16) {\n" +
          "        return BEFORE_INITIALIZE | BEFORE_MINT | BEFORE_SWAP;\n" +
          "    }\n\n" +
          "    function _beforeMint(address, PoolKey calldata key, ...)\n" +
          "        internal view override returns (bytes4, uint24)\n" +
          "    {\n" +
          "        return (IBinHooks.beforeMint.selector, _currentFee(key) | LPFeeLibrary.OVERRIDE_FEE_FLAG);\n" +
          "    }\n\n" +
          "Note the bin fee ceiling is `LPFeeLibrary.TEN_PERCENT_FEE` (100_000), not 1_000_000: core reverts " +
          "a larger bin LP fee with `LPFeeTooLarge`.",
      },
    ];
  },
};
