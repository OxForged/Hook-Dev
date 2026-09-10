/**
 * LOCAL HARNESS STUB - do not submit this file upstream.
 *
 * Upstream `helpers/lists.ts` exports `getDefaultDexTokensBlacklisted(chain)`, the
 * central list of spam/fake/hacked tokens that pollute uni-style volume. AGENTS.md:
 * "Spam/fake tokens that pollute uni-style volume go in a central blacklist, not
 * into individual adapters." The adapter calls it so that it picks the real list up
 * upstream; locally it returns nothing, which is correct for a chain with no pools.
 */
export function getDefaultDexTokensBlacklisted(_chain: string): string[] {
  return [];
}
