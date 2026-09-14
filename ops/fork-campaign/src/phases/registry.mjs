// SPDX-License-Identifier: MIT
// LatchRegistry 0xb2c8. MUST-TEST: list / flag / unflag with curator and guardian roles.
// Live roles (read on the fork): Safe = DEFAULT_ADMIN_ROLE (adminCount 1); ops key = CURATOR + GUARDIAN.
// Because the ops key holds BOTH roles, guardian-only behaviour is exercised by an account the Safe
// grants GUARDIAN alone.
import { ADDR } from "../addresses.mjs";
import { artifact } from "../abis.mjs";
import { ABI, ACTORS, clKey, poolId, Q96, ZERO } from "../lib.mjs";

const Listing = { Active: 0, Deprecated: 1, Malicious: 2 };
const Verification = { Unverified: 0, SourceVerified: 1, Audited: 2 };

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, dave, erin, mallory } = ACTORS;
  const { safe, opsKey, registry: REG, clPoolManager: CLM } = ADDR;
  const RG = ABI.LatchRegistry, CL = ABI.CLPoolManager, BH = artifact("helpers/BitmapHook");
  const S = (o) => rec.send({ to: REG, abi: RG, contract: "LatchRegistry", ...o });
  const md = (name, src = "https://example.invalid/src", audit = "") => ({ name, description: `fork campaign ${name}`, sourceURI: src, auditURI: audit, chainIds: [4663n] });
  const CURATOR = await chain.read(REG, RG, "CURATOR_ROLE");
  const GUARDIAN = await chain.read(REG, RG, "GUARDIAN_ROLE");
  const ADMIN = await chain.read(REG, RG, "DEFAULT_ADMIN_ROLE");

  rec.scenario("registry roles", "grantRole / revokeRole / renounceRole x3; the admin role cannot be dropped");
  await S({ from: safe, fn: "grantRole", args: [GUARDIAN, carol], note: "guardian-only account" });
  await S({ from: safe, fn: "grantRole", args: [CURATOR, dave], note: "curator-only account" });
  await S({ from: safe, fn: "grantRole", args: [GUARDIAN, erin] });
  await S({ from: mallory, fn: "grantRole", args: [CURATOR, mallory], role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount" });
  await S({ from: opsKey, fn: "grantRole", args: [CURATOR, mallory], role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount", note: "curator cannot appoint curators" });

  rec.scenario("MUST registry list/flag/unflag", "Permissionless register, pool attestation, curator verification, guardian flag (escalate-only), curator unflag");
  // three hooks: two bitmap-0 test hooks with real pools, and the live RevShareHook 0xfC00
  const hooks = [];
  for (let i = 0; i < 3; i++) hooks.push(await rec.deploy({ from: alice, abi: BH.abi, bytecode: BH.bytecode, args: [0], contract: "BitmapHook" }));
  const pools = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const k = clKey(state.tokens.TKA, state.tokens.TKB, { fee: 3000 + i * 10 + j, tickSpacing: 60, hooks: hooks[i], bitmap: 0 });
      await rec.send({ from: alice, to: CLM, abi: CL, fn: "initialize", args: [k, Q96], contract: "CLPoolManager", role: "setup" });
      pools.push({ hook: hooks[i], key: k, id: poolId(k) });
    }
  }
  await S({ from: bob, fn: "register", args: [hooks[0], md("Test hook 0")], note: "permissionless" });
  await S({ from: carol, fn: "register", args: [ADDR.revShareHookCurrent, md("RevShareHook")], note: "a stranger lists the protocol's own hook first (CLAUDE.md runbook risk)" });
  await S({ from: erin, fn: "register", args: [ADDR.revShareHookRetired, md("RevShareHook (retired)")] });
  rec.assert("stranger is steward of the protocol's RevShareHook listing", (await chain.read(REG, RG, "getLatch", [ADDR.revShareHookCurrent])).steward, carol);
  await S({ from: mallory, fn: "register", args: [hooks[0], md("dup")], role: "unauthorized", expect: "revert", expectError: "LatchAlreadyRegistered" });
  await S({ from: mallory, fn: "register", args: [mallory, md("eoa")], role: "unauthorized", expect: "revert", expectError: "LatchHasNoCode" });
  rec.notExercised("LatchRegistry", "register", "permissionless by design; negatives are duplicate / no-code / invalid metadata");
  for (let i = 1; i < 3; i++) await S({ from: [alice, bob][i - 1], fn: "registerWithPool", args: [hooks[i], md(`Test hook ${i}`), CLM, pools[i * 2].id] });
  await S({ from: bob, fn: "registerWithPool", args: [ADDR.launchGuardHook, md("LGH"), CLM, pools[0].id], role: "unauthorized", expect: "revert", expectError: "PoolHookMismatch", note: "a pool whose key names another hook" });
  const lgh = await rec.deploy({ from: alice, abi: BH.abi, bytecode: BH.bytecode, args: [0], contract: "BitmapHook" });
  const lk = clKey(state.tokens.TKC, state.tokens.TKD, { fee: 3000, tickSpacing: 60, hooks: lgh, bitmap: 0 });
  await rec.send({ from: alice, to: CLM, abi: CL, fn: "initialize", args: [lk, Q96], contract: "CLPoolManager", role: "setup" });
  await S({ from: carol, fn: "registerWithPool", args: [lgh, md("Test hook 3"), CLM, poolId(lk)] });
  // attestations
  for (const p of [pools[1], pools[3], pools[5]]) await S({ from: mallory, fn: "attestFromPool", args: [p.hook, CLM, p.id], note: "permissionless: reads the bitmap core enforced" });
  await S({ from: mallory, fn: "attestFromPool", args: [pools[1].hook, CLM, pools[1].id], role: "unauthorized", expect: "revert", expectError: "PoolAlreadyAttested" });
  await S({ from: mallory, fn: "attestFromPool", args: [hooks[0], mallory, pools[0].id], role: "unauthorized", expect: "revert", expectError: "UntrustedPoolManager", note: "a manager the Vault never registered" });
  rec.notExercised("LatchRegistry", "attestFromPool", "permissionless by design");
  for (const p of [pools[0], pools[2], pools[4]].slice(0, 1)) await S({ from: dave, fn: "attestFromPoolKey", args: [p.hook, p.key] });
  const extra = [];
  for (let i = 0; i < 2; i++) {
    const k = clKey(state.tokens.TKE, state.tokens.TKF, { fee: 500 + i, tickSpacing: 10, hooks: hooks[i + 1], bitmap: 0 });
    await rec.send({ from: alice, to: CLM, abi: CL, fn: "initialize", args: [k, Q96], contract: "CLPoolManager", role: "setup" });
    extra.push(k);
    await S({ from: [erin, bob][i], fn: "attestFromPoolKey", args: [hooks[i + 1], k] });
  }
  rec.notExercised("LatchRegistry", "attestFromPoolKey", "permissionless by design");
  rec.assert("hook 0 attestationCount == 2", (await chain.read(REG, RG, "attestationOf", [hooks[0]]))[0], 2);
  // refreshPermissions x3: change the self-reported bitmap on each test hook
  for (const [i, b] of [[0, 0x0081], [1, 0x0041], [2, 0x0001]].entries()) {
    await rec.send({ from: alice, to: hooks[b[0]], abi: BH.abi, fn: "setBitmap", args: [b[1]], contract: "BitmapHook", role: "setup" });
    await S({ from: [mallory, bob, erin][i], fn: "refreshPermissions", args: [hooks[b[0]]], note: `self-report now 0x${b[1].toString(16)}` });
  }
  await S({ from: mallory, fn: "refreshPermissions", args: [hooks[0]], role: "unauthorized", expect: "revert", expectError: "PermissionsUnchanged" });
  rec.notExercised("LatchRegistry", "refreshPermissions", "permissionless by design");
  // steward actions
  await S({ from: bob, fn: "updateMetadata", args: [hooks[0], md("Hook 0 v2")], note: "steward" });
  await S({ from: opsKey, fn: "updateMetadata", args: [ADDR.revShareHookCurrent, md("RevShareHook (curated)")], note: "curator overrides the stranger's metadata" });
  await S({ from: dave, fn: "updateMetadata", args: [hooks[1], md("Hook 1 curated")], note: "curator-only account" });
  await S({ from: mallory, fn: "updateMetadata", args: [hooks[0], md("pwned")], role: "unauthorized", expect: "revert", expectError: "NotSteward" });
  await S({ from: opsKey, fn: "transferSteward", args: [ADDR.revShareHookCurrent, opsKey], note: "curator reclaims the protocol's listing" });
  await S({ from: bob, fn: "transferSteward", args: [hooks[0], dave] });
  await S({ from: dave, fn: "transferSteward", args: [hooks[0], bob] });
  await S({ from: mallory, fn: "transferSteward", args: [hooks[0], mallory], role: "unauthorized", expect: "revert", expectError: "NotSteward" });
  // verification x3 (curator)
  await S({ from: opsKey, fn: "setVerification", args: [ADDR.revShareHookRetired, Verification.SourceVerified, "x"], role: "unauthorized", expect: "revert", expectError: "AttestationRequired", note: "no pool attested" });
  await S({ from: opsKey, fn: "setVerification", args: [hooks[0], Verification.SourceVerified, "source matches"] });
  await S({ from: opsKey, fn: "updateMetadata", args: [hooks[1], md("Hook 1 audited", "https://example.invalid/src", "https://example.invalid/audit")], role: "setup" });
  await S({ from: dave, fn: "setVerification", args: [hooks[1], Verification.Audited, "audited"] });
  await S({ from: opsKey, fn: "setVerification", args: [hooks[1], Verification.Unverified, "rollback"] });
  await S({ from: carol, fn: "setVerification", args: [hooks[0], Verification.Audited, "guardian tries"], role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount", note: "guardian-only account cannot verify" });
  await S({ from: mallory, fn: "setVerification", args: [hooks[0], Verification.Audited, ""], role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount" });
  // FLAG / UNFLAG
  const status = async (h) => (await chain.read(REG, RG, "statusOf", [h]))[1];
  await S({ from: carol, fn: "setListing", args: [hooks[0], Listing.Deprecated, "guardian: deprecate"], note: "guardian escalates" });
  await S({ from: carol, fn: "setListing", args: [hooks[0], Listing.Malicious, "guardian: FLAG malicious"], note: "guardian flags malicious (verification demoted)" });
  rec.assert("hook 0 flagged Malicious and demoted to Unverified", [await status(hooks[0]), (await chain.read(REG, RG, "statusOf", [hooks[0]]))[0]], [Listing.Malicious, Verification.Unverified], (a, b) => a[0] === b[0] && a[1] === b[1]);
  await S({ from: carol, fn: "setListing", args: [hooks[0], Listing.Active, "guardian tries to unflag"], role: "unauthorized", expect: "revert", expectError: "GuardianCannotRelist" });
  await S({ from: opsKey, fn: "setVerification", args: [hooks[0], Verification.SourceVerified, "while malicious"], role: "unauthorized", expect: "revert", expectError: "LatchFlaggedMalicious" });
  await S({ from: dave, fn: "setListing", args: [hooks[0], Listing.Active, "curator: UNFLAG after review"], note: "curator unflags" });
  rec.assert("hook 0 Active again after the curator unflag", await status(hooks[0]), Listing.Active);
  await S({ from: opsKey, fn: "setListing", args: [ADDR.revShareHookRetired, Listing.Deprecated, "retired hook"] });
  await S({ from: erin, fn: "setListing", args: [hooks[2], Listing.Malicious, "second guardian"] });
  await S({ from: mallory, fn: "setListing", args: [hooks[1], Listing.Malicious, "grief"], role: "unauthorized", expect: "revert", expectError: "NotCuratorOrGuardian" });

  rec.scenario("registry role revoke/renounce", "revoke x3, renounce x3, admin protections");
  for (const [role, who] of [[GUARDIAN, carol], [CURATOR, dave], [GUARDIAN, erin]].slice(0, 2)) await S({ from: safe, fn: "revokeRole", args: [role, who] });
  await S({ from: safe, fn: "grantRole", args: [CURATOR, bob], role: "setup" });
  await S({ from: safe, fn: "revokeRole", args: [CURATOR, bob] });
  await S({ from: safe, fn: "revokeRole", args: [ADMIN, safe], role: "unauthorized", expect: "revert", expectError: "LastAdminCannotBeRemoved" });
  await S({ from: mallory, fn: "revokeRole", args: [CURATOR, opsKey], role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount" });
  await S({ from: erin, fn: "renounceRole", args: [GUARDIAN, erin] });
  for (const [role, who] of [[CURATOR, alice], [GUARDIAN, alice]]) {
    await S({ from: safe, fn: "grantRole", args: [role, who], role: "setup" });
    await S({ from: who, fn: "renounceRole", args: [role, who] });
  }
  await S({ from: safe, fn: "renounceRole", args: [ADMIN, safe], role: "unauthorized", expect: "revert", expectError: "AdminRoleIsNotRenounceable", note: "registry analogue of renounceOwnership: refused" });
  await S({ from: mallory, fn: "renounceRole", args: [CURATOR, opsKey], role: "unauthorized", expect: "revert", expectError: "AccessControlBadConfirmation" });
  rec.assert("adminCount still 1", await chain.read(REG, RG, "adminCount"), 1n);
  state.registryHooks = hooks;
}
