// SPDX-License-Identifier: MIT
// LatchLaunchRegistry 0x6D10. Roles are read from LatchRegistry (ops key = curator + guardian).
import { ADDR } from "../addresses.mjs";
import { artifact } from "../abis.mjs";
import { ABI, ACTORS, clKey, poolId, Q96, ZERO } from "../lib.mjs";

const Listing = { Active: 0, Deprecated: 1, Malicious: 2 };
const Verification = { Unverified: 0, SourceVerified: 1, Audited: 2 };

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, dave, erin, mallory } = ACTORS;
  const { safe, opsKey, launchRegistry: LR, registry: REG, clPoolManager: CLM } = ADDR;
  const L = ABI.LatchLaunchRegistry, CL = ABI.CLPoolManager, MLP = artifact("helpers/MockLaunchpad"), BH = artifact("helpers/BitmapHook");
  const S = (o) => rec.send({ to: LR, abi: L, contract: "LatchLaunchRegistry", ...o });
  const lmd = (d) => ({ description: d, websiteURI: "https://example.invalid", iconURI: "", socialURI: "" });
  const pmd = (n, src = "https://example.invalid/src", audit = "") => ({ name: n, description: `launchpad ${n}`, sourceURI: src, auditURI: audit, websiteURI: "" });

  // a guardian-only account (LatchLaunchRegistry reads roles from LatchRegistry)
  await rec.send({ from: safe, to: REG, abi: ABI.LatchRegistry, fn: "grantRole", args: [await chain.read(REG, ABI.LatchRegistry, "GUARDIAN_ROLE"), carol], contract: "LatchRegistry", role: "setup" });

  rec.scenario("launch registry: launchpads", "registerLaunchpad / claimLaunchpad / metadata / steward / code refresh / verification / listing x3");
  const pads = [];
  for (let i = 0; i < 3; i++) pads.push(await rec.deploy({ from: alice, abi: MLP.abi, bytecode: MLP.bytecode, contract: "MockLaunchpad" }));
  await S({ from: pads[0], fn: "registerLaunchpad", args: [pads[0], alice, pmd("Pad0")], note: "self-registration: msg.sender is the launchpad contract (impersonated)" });
  await S({ from: bob, fn: "registerLaunchpad", args: [pads[1], ZERO, pmd("Pad1")], note: "claimed by a third party" });
  await S({ from: carol, fn: "registerLaunchpad", args: [pads[2], dave, pmd("Pad2")] });
  await S({ from: mallory, fn: "registerLaunchpad", args: [pads[0], mallory, pmd("dup")], role: "unauthorized", expect: "revert", expectError: "LaunchpadAlreadyRegistered" });
  await S({ from: mallory, fn: "registerLaunchpad", args: [mallory, mallory, pmd("eoa")], role: "unauthorized", expect: "revert", expectError: "LaunchpadHasNoCode" });
  rec.notExercised("LatchLaunchRegistry", "registerLaunchpad", "permissionless by design");
  for (const [i, steward] of [[1, bob], [2, erin], [0, carol]]) await S({ from: pads[i], fn: "claimLaunchpad", args: [steward], note: "the launchpad contract itself claims its record" });
  await S({ from: mallory, fn: "claimLaunchpad", args: [mallory], role: "unauthorized", expect: "revert", expectError: "LaunchpadNotRegistered", note: "caller is not a registered launchpad" });
  await S({ from: bob, fn: "updateLaunchpadMetadata", args: [pads[1], pmd("Pad1 v2")], note: "steward" });
  await S({ from: opsKey, fn: "updateLaunchpadMetadata", args: [pads[2], pmd("Pad2 curated", "https://example.invalid/src", "https://example.invalid/audit")], note: "curator" });
  await S({ from: carol, fn: "updateLaunchpadMetadata", args: [pads[0], pmd("Pad0 v2")], note: "steward (claimed above)" });
  await S({ from: mallory, fn: "updateLaunchpadMetadata", args: [pads[0], pmd("x")], role: "unauthorized", expect: "revert", expectError: "NotLaunchpadSteward" });
  await S({ from: bob, fn: "transferLaunchpadSteward", args: [pads[1], dave] });
  await S({ from: dave, fn: "transferLaunchpadSteward", args: [pads[1], bob] });
  await S({ from: opsKey, fn: "transferLaunchpadSteward", args: [pads[2], opsKey], note: "curator" });
  await S({ from: mallory, fn: "transferLaunchpadSteward", args: [pads[1], mallory], role: "unauthorized", expect: "revert", expectError: "NotLaunchpadSteward" });

  rec.scenario("launch registry: launches", "registerLaunch x3 (claimed, launchpad-vouched, self-vouched), attest origin, clear attribution, token refresh, hook attestation forwarding, listing");
  const hook = await rec.deploy({ from: alice, abi: BH.abi, bytecode: BH.bytecode, args: [0], contract: "BitmapHook" });
  await rec.send({ from: bob, to: REG, abi: ABI.LatchRegistry, fn: "register", args: [hook, { name: "launch hook", description: "", sourceURI: "", auditURI: "", chainIds: [] }], contract: "LatchRegistry", role: "setup" });
  const keys = [];
  const toks = [state.tokens.TKA, state.tokens.TKC, state.tokens.TKE];
  for (let i = 0; i < 4; i++) {
    const k = clKey(toks[i % 3], state.tokens.TKF, { fee: 3000 + i, tickSpacing: 60, hooks: i === 2 ? hook : ZERO, bitmap: 0 });
    await rec.send({ from: alice, to: CLM, abi: CL, fn: "initialize", args: [k, Q96], contract: "CLPoolManager", role: "setup" });
    keys.push({ k, id: poolId(k), token: toks[i % 3] });
  }
  await S({ from: alice, fn: "registerLaunch", args: [CLM, keys[0].id, keys[0].token, ZERO, alice, ZERO, lmd("claimed launch")], note: "origin Claimed" });
  await rec.send({ from: alice, to: pads[1], abi: MLP.abi, fn: "setCreator", args: [keys[1].id, erin], contract: "MockLaunchpad", role: "setup" });
  await S({ from: bob, fn: "registerLaunch", args: [CLM, keys[1].id, keys[1].token, pads[1], mallory, bob, lmd("vouched launch")], note: "launchpad vouches; caller-supplied creator is IGNORED in favour of the vouched one" });
  rec.assert("vouched launch creator == the launchpad's answer (erin), not the caller's (mallory)", (await chain.read(LR, L, "getLaunch", [keys[1].id])).creator, erin);
  await S({ from: carol, fn: "registerLaunch", args: [CLM, keys[2].id, keys[2].token, ZERO, carol, dave, lmd("hooked launch")], note: "pool with a hook: forwards the attestation to LatchRegistry" });
  await S({ from: mallory, fn: "registerLaunch", args: [CLM, keys[0].id, keys[0].token, ZERO, mallory, ZERO, lmd("dup")], role: "unauthorized", expect: "revert", expectError: "LaunchAlreadyRegistered" });
  await S({ from: mallory, fn: "registerLaunch", args: [CLM, keys[3].id, state.tokens.TKB, ZERO, mallory, ZERO, lmd("wrong token")], role: "unauthorized", expect: "revert", expectError: "TokenNotInPool" });
  await S({ from: mallory, fn: "registerLaunch", args: [CLM, keys[3].id, keys[3].token, pads[2], mallory, ZERO, lmd("no vouch")], role: "unauthorized", expect: "revert", expectError: "LaunchpadDidNotVouch" });
  rec.notExercised("LatchLaunchRegistry", "registerLaunch", "permissionless by design; attribution requires a vouch");
  // attestLaunchOrigin x3: register 2 more claimed launches, then attest them
  await S({ from: dave, fn: "registerLaunch", args: [CLM, keys[3].id, keys[3].token, ZERO, dave, ZERO, lmd("claimed 2")], role: "setup" });
  await rec.send({ from: alice, to: pads[0], abi: MLP.abi, fn: "setCreator", args: [keys[0].id, alice], contract: "MockLaunchpad", role: "setup" });
  await S({ from: mallory, fn: "attestLaunchOrigin", args: [keys[0].id, pads[0], ZERO], note: "anyone may attach a launchpad that vouches" });
  await S({ from: pads[2], fn: "attestLaunchOrigin", args: [keys[3].id, pads[2], dave], note: "the launchpad itself attests (impersonated contract)" });
  await rec.send({ from: alice, to: pads[1], abi: MLP.abi, fn: "setCreator", args: [keys[2].id, carol], contract: "MockLaunchpad", role: "setup" });
  await S({ from: erin, fn: "attestLaunchOrigin", args: [keys[2].id, pads[1], ZERO] });
  await S({ from: mallory, fn: "attestLaunchOrigin", args: [keys[0].id, pads[1], ZERO], role: "unauthorized", expect: "revert", expectError: "OriginAlreadyAttested" });
  rec.notExercised("LatchLaunchRegistry", "attestLaunchOrigin", "permissionless by design; requires the launchpad's vouch");
  for (const id of [keys[0].id, keys[2].id, keys[3].id]) await S({ from: opsKey, fn: "clearLaunchAttribution", args: [id, "curator review"] });
  await S({ from: opsKey, fn: "clearLaunchAttribution", args: [keys[0].id, "again"], role: "unauthorized", expect: "revert", expectError: "NoAttributionToClear" });
  await S({ from: carol, fn: "clearLaunchAttribution", args: [keys[1].id, "guardian"], role: "unauthorized", expect: "revert", expectError: "NotCurator", note: "guardian-only account" });
  for (const [i, who] of [[0, mallory], [1, bob], [2, erin]]) await S({ from: who, fn: "refreshTokenInfo", args: [keys[i].id] });
  await S({ from: mallory, fn: "refreshTokenInfo", args: [`0x${"ab".repeat(32)}`], role: "unauthorized", expect: "revert", expectError: "LaunchNotRegistered" });
  rec.notExercised("LatchLaunchRegistry", "refreshTokenInfo", "permissionless by design");
  for (const [i, who] of [[2, mallory], [0, bob], [1, carol]]) await S({ from: who, fn: "attestHookFromLaunch", args: [keys[i].id], note: i === 2 ? "hooked pool: forwarded (already attested at register -> ok=false, no revert)" : "hookless pool: returns false" });
  rec.notExercised("LatchLaunchRegistry", "attestHookFromLaunch", "permissionless by design; the forward is try/catch");
  await S({ from: alice, fn: "updateLaunchMetadata", args: [keys[0].id, lmd("updated by steward")], note: "steward (registrant default)" });
  await S({ from: opsKey, fn: "updateLaunchMetadata", args: [keys[1].id, lmd("curated")], note: "curator" });
  await S({ from: dave, fn: "updateLaunchMetadata", args: [keys[2].id, lmd("steward set at register")] });
  await S({ from: mallory, fn: "updateLaunchMetadata", args: [keys[0].id, lmd("x")], role: "unauthorized", expect: "revert", expectError: "NotLaunchSteward" });
  await S({ from: alice, fn: "transferLaunchSteward", args: [keys[0].id, bob] });
  await S({ from: bob, fn: "transferLaunchSteward", args: [keys[0].id, alice] });
  await S({ from: opsKey, fn: "transferLaunchSteward", args: [keys[2].id, carol], note: "curator" });
  await S({ from: mallory, fn: "transferLaunchSteward", args: [keys[0].id, mallory], role: "unauthorized", expect: "revert", expectError: "NotLaunchSteward" });
  await S({ from: carol, fn: "setLaunchListing", args: [keys[0].id, Listing.Malicious, "guardian flag"], note: "guardian escalates" });
  await S({ from: carol, fn: "setLaunchListing", args: [keys[0].id, Listing.Active, "guardian unflag"], role: "unauthorized", expect: "revert", expectError: "GuardianCannotRelist" });
  await S({ from: opsKey, fn: "setLaunchListing", args: [keys[0].id, Listing.Active, "curator unflag"] });
  await S({ from: opsKey, fn: "setLaunchListing", args: [keys[1].id, Listing.Deprecated, "curator"] });
  await S({ from: mallory, fn: "setLaunchListing", args: [keys[1].id, Listing.Malicious, "grief"], role: "unauthorized", expect: "revert", expectError: "NotCuratorOrGuardian" });

  rec.scenario("launch registry: launchpad verification, listing, code refresh", "needs a self-registered launchpad with at least one launch");
  // pads[1] vouched keys[1] at registration and was claimed by itself -> SelfRegistered with a launch
  await S({ from: opsKey, fn: "setLaunchpadVerification", args: [pads[1], Verification.SourceVerified, "ok"] });
  await S({ from: opsKey, fn: "updateLaunchpadMetadata", args: [pads[1], pmd("Pad1 audited", "https://example.invalid/src", "https://example.invalid/audit")], role: "setup" });
  await S({ from: opsKey, fn: "setLaunchpadVerification", args: [pads[1], Verification.Audited, "audited"] });
  await S({ from: opsKey, fn: "setLaunchpadVerification", args: [pads[1], Verification.Unverified, "rollback"] });
  await S({ from: carol, fn: "setLaunchpadVerification", args: [pads[1], Verification.Audited, "guardian"], role: "unauthorized", expect: "revert", expectError: "NotCurator" });
  // FINDING check: pads[2]'s only launch attribution (keys[3]) was cleared by a curator above.
  rec.assert("keys[3] attribution cleared: getLaunch.launchpad == 0", (await chain.read(LR, L, "getLaunch", [keys[3].id])).launchpad, ZERO);
  const staleCount = await chain.read(LR, L, "launchpadLaunchCount", [pads[2]]);
  const staleList = await chain.read(LR, L, "launchesOfLaunchpad", [pads[2], 0n, 10n]);
  rec.note("FINDING (Low): clearLaunchAttribution resets record.launchpad but never removes the pool from _byLaunchpad[launchpad]. launchpadLaunchCount/launchesOfLaunchpad keep reporting the cleared launch, and setLaunchpadVerification's LaunchpadHasNoLaunches gate still passes on it.", { launchpad: pads[2], launchpadLaunchCountAfterClear: staleCount, launchesOfLaunchpad: staleList });
  const v = await S({ from: opsKey, fn: "setLaunchpadVerification", args: [pads[2], Verification.SourceVerified, "only launch attribution was cleared"], note: "FINDING: succeeds although every attribution to this pad was cleared" });
  rec.assert("FINDING reproduced: a launchpad with zero current attributions was verified", v.status, "success");
  const lone = await rec.deploy({ from: alice, abi: MLP.abi, bytecode: MLP.bytecode, contract: "MockLaunchpad" });
  await S({ from: lone, fn: "registerLaunchpad", args: [lone, alice, pmd("Lone")], role: "setup" });
  await S({ from: opsKey, fn: "setLaunchpadVerification", args: [lone, Verification.SourceVerified, "no launches"], role: "unauthorized", expect: "revert", expectError: "LaunchpadHasNoLaunches" });
  await S({ from: carol, fn: "setLaunchpadListing", args: [pads[0], Listing.Deprecated, "guardian"] });
  await S({ from: carol, fn: "setLaunchpadListing", args: [pads[0], Listing.Malicious, "guardian flag"] });
  await S({ from: opsKey, fn: "setLaunchpadListing", args: [pads[0], Listing.Active, "curator unflag"] });
  await S({ from: carol, fn: "setLaunchpadListing", args: [pads[0], Listing.Active, "relist"], role: "unauthorized", expect: "revert", expectError: "GuardianCannotRelist" });
  await S({ from: mallory, fn: "setLaunchpadListing", args: [pads[0], Listing.Malicious, "x"], role: "unauthorized", expect: "revert", expectError: "NotCuratorOrGuardian" });
  for (let i = 0; i < 3; i++) {
    const code = await chain.code(pads[i]);
    await chain.rpc("anvil_setCode", [pads[i], `${code}${"00".repeat(i + 1)}`]);
    await S({ from: [mallory, bob, erin][i], fn: "refreshLaunchpadCode", args: [pads[i]], note: "launchpad code changed (anvil_setCode appends bytes): record demoted" });
  }
  await S({ from: mallory, fn: "refreshLaunchpadCode", args: [pads[0]], role: "unauthorized", expect: "revert", expectError: "CodehashUnchanged" });
  rec.notExercised("LatchLaunchRegistry", "refreshLaunchpadCode", "permissionless by design");
}
