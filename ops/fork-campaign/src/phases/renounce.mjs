// SPDX-License-Identifier: MIT
// HAZARD §1: renounceOwnership() on every contract where it is live, each on its own snapshot, and
// what bricks afterwards. renounceOwnership takes no arguments, so it is executed ONCE per contract
// (a second call reverts: there is no owner left) plus one unauthorized attempt.
import { encodeFunctionData } from "viem";
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, swapInPlan, ZERO } from "../lib.mjs";

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, mallory } = ACTORS;
  const { safe, opsKey } = ADDR;
  const dl = async () => (await chain.head()).timestamp + 3600n;
  const OWNER = [{ type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }];

  const renounce = async (contract, address, abi, owner, after) => {
    const s = await chain.snapshot();
    rec.scenario(`HAZARD §1 renounceOwnership ${contract}`, `owner ${owner}`);
    await rec.send({ from: mallory, to: address, abi, fn: "renounceOwnership", contract, role: "unauthorized", expect: "revert" });
    const r = await rec.send({ from: owner, to: address, abi, fn: "renounceOwnership", contract, role: "hazard", expect: after.expect ?? "success", expectError: after.expectError, note: after.note });
    const newOwner = r.status === "success" ? await chain.read(address, OWNER, "owner") : owner;
    if (r.status === "success") rec.assert(`${contract}: owner() == 0 after renounce`, newOwner, ZERO);
    const evidence = { renounceTx: r.txHash, status: r.status, error: r.error, ownerAfter: newOwner };
    if (r.status === "success") await after.bricked(evidence);
    rec.hazard(`§1-${contract}`, after.title, evidence, r.status === "success");
    await chain.revert(s);
  };

  await renounce("Vault", ADDR.vault, ABI.Vault, safe, {
    title: "Vault: registerApp is gone forever - no new pool manager or app, ever",
    bricked: async (ev) => {
      const x = await rec.send({ from: safe, to: ADDR.vault, abi: ABI.Vault, fn: "registerApp", args: [state.actor], contract: "Vault", role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
      const y = await rec.send({ from: safe, to: ADDR.vault, abi: ABI.Vault, fn: "transferOwnership", args: [ADDR.timelockCustody], contract: "Vault", role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
      Object.assign(ev, { registerAppAfter: x.error, transferOwnershipAfter: y.error });
    },
  });

  for (const [W, WN, M, MABI] of [[ADDR.clPoolManagerOwner, "CLPoolManagerOwner", ADDR.clPoolManager, ABI.CLPoolManager], [ADDR.binPoolManagerOwner, "BinPoolManagerOwner", ADDR.binPoolManager, ABI.BinPoolManager]]) {
    const WA = ABI[WN];
    // realistic precondition: the Ops pausable role the ownership table prescribes
    const s0 = await chain.snapshot();
    await rec.send({ from: safe, to: W, abi: WA, fn: "grantPausableRole", args: [opsKey], contract: WN, role: "setup", note: "grant the pausable role to Ops (per the ownership table) before the renounce" });
    const s = await chain.snapshot();
    rec.scenario(`HAZARD §1 renounceOwnership ${WN}`, "owner = Safe; ops key holds the pausable role");
    await rec.send({ from: mallory, to: W, abi: WA, fn: "renounceOwnership", contract: WN, role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    const r = await rec.send({ from: safe, to: W, abi: WA, fn: "renounceOwnership", contract: WN, role: "hazard" });
    const p = await rec.send({ from: opsKey, to: W, abi: WA, fn: "pausePoolManager", contract: WN, role: "hazard", note: "a pausable-role holder can STILL pause" });
    const paused = await chain.read(M, MABI, "paused");
    const u = await rec.send({ from: safe, to: W, abi: WA, fn: "unpausePoolManager", contract: WN, role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount", note: "nobody can unpause" });
    const u2 = await rec.send({ from: opsKey, to: W, abi: WA, fn: "unpausePoolManager", contract: WN, role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    const t = await rec.send({ from: safe, to: W, abi: WA, fn: "transferPoolManagerOwnership", args: [safe], contract: WN, role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount", note: "the manager can never move to a replacement wrapper" });
    const f = await rec.send({ from: safe, to: W, abi: WA, fn: "setProtocolFeeController", args: [ZERO], contract: WN, role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    let swapWhilePaused = null;
    if (WN === "CLPoolManagerOwner") {
      const k = state.baseCL.key;
      const sw = await rec.send({ from: alice, to: ADDR.universalRouter, abi: ABI.UniversalRouter, fn: "execute", args: ["0x10", [swapInPlan(k, true, 10n ** 18n)], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", role: "hazard", expect: "revert", expectError: "EnforcedPause", note: "every CL pool is frozen for trading, permanently" });
      swapWhilePaused = sw.error;
    }
    rec.hazard(`§1-${WN}`, `${WN}: after renounce the manager is pausable by an Ops key and UNPAUSABLE by anyone (worse than losing both)`, { renounceTx: r.txHash, pauseAfterRenounce: p.status, managerPaused: paused, unpauseBySafe: u.error, unpauseByOps: u2.error, transferPoolManagerOwnership: t.error, setProtocolFeeController: f.error, swapWhilePaused }, r.status === "success" && p.status === "success" && paused === true);
    await chain.revert(s0);
  }

  await renounce("RevShareHook_23CE", ADDR.revShareHookRetired, ABI.RevShareHook_23CE, safe, {
    title: "RevShareHook 0x23CE: global unpause and setGuardian gone; guardian can still pause; revert is NotGuardianOrOwner (not the OZ error)",
    bricked: async (ev) => {
      const H = ADDR.revShareHookRetired, RS = ABI.RevShareHook_23CE;
      const p = await rec.send({ from: opsKey, to: H, abi: RS, fn: "setPaused", args: [true], contract: "RevShareHook_23CE", role: "hazard", note: "guardian pauses" });
      const u = await rec.send({ from: safe, to: H, abi: RS, fn: "setPaused", args: [false], contract: "RevShareHook_23CE", role: "hazard", expect: "revert", expectError: "NotGuardianOrOwner", note: "former owner cannot unpause; error is NotGuardianOrOwner" });
      const g = await rec.send({ from: safe, to: H, abi: RS, fn: "setGuardian", args: [safe], contract: "RevShareHook_23CE", role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
      const st = await rec.send({ from: mallory, to: H, abi: RS, fn: "settleBeneficiaries", args: [await (async () => { const a = await chain.read(ADDR.clPoolManager, ABI.CLPoolManager, "poolIdToPoolKey", [ADDR.demoPoolId]); return { currency0: a[0], currency1: a[1], hooks: a[2], poolManager: a[3], fee: a[4], parameters: a[5] }; })(), ADDR.ltt1], contract: "RevShareHook_23CE", role: "hazard", note: "pool-level plumbing unaffected" });
      Object.assign(ev, { guardianPause: p.status, unpauseError: u.error, setGuardianError: g.error, settleStillWorks: st.status, hookStuckPaused: await chain.read(H, RS, "paused") });
    },
  });
  await renounce("RevShareHook_fC00", ADDR.revShareHookCurrent, ABI.RevShareHook_fC00, safe, { expect: "revert", expectError: "RenounceDisabled", title: "RevShareHook 0xfC00: renounce disabled (fix confirmed)", note: "override reverts", bricked: async () => {} });
  await renounce("LatchProtocolFeeControllerV2", ADDR.feeControllerV2, ABI.LatchProtocolFeeControllerV2, safe, { expect: "revert", expectError: "RenounceDisabled", title: "Fee controller V2: renounce disabled", bricked: async () => {} });
  await renounce("UniversalRouter", ADDR.universalRouter, ABI.UniversalRouter, safe, {
    title: "UniversalRouter: renounced while unpaused -> pause/unpause gone (a router renounced while paused is bricked forever)",
    bricked: async (ev) => {
      const p = await rec.send({ from: safe, to: ADDR.universalRouter, abi: ABI.UniversalRouter, fn: "pause", contract: "UniversalRouter", role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
      ev.pauseAfter = p.error;
    },
  });
  // router renounced WHILE paused
  {
    const s = await chain.snapshot();
    rec.scenario("HAZARD §1 UniversalRouter renounced while paused", "pause, renounce, then nobody can unpause");
    await rec.send({ from: safe, to: ADDR.universalRouter, abi: ABI.UniversalRouter, fn: "pause", contract: "UniversalRouter", role: "setup" });
    const r = await rec.send({ from: safe, to: ADDR.universalRouter, abi: ABI.UniversalRouter, fn: "renounceOwnership", contract: "UniversalRouter", role: "hazard" });
    const u = await rec.send({ from: safe, to: ADDR.universalRouter, abi: ABI.UniversalRouter, fn: "unpause", contract: "UniversalRouter", role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    const sw = await rec.send({ from: alice, to: ADDR.universalRouter, abi: ABI.UniversalRouter, fn: "execute", args: ["0x10", [swapInPlan(state.baseCL.key, true, 10n ** 18n)], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", role: "hazard", expect: "revert", expectError: "EnforcedPause" });
    rec.hazard("§1-UniversalRouter-paused", "UniversalRouter renounced while paused: permanently unusable (users must route around it)", { renounceTx: r.txHash, unpause: u.error, swap: sw.error }, r.status === "success" && sw.status === "revert");
    await chain.revert(s);
  }
  for (const [n, a] of [["CLProtocolFeeController", ADDR.clProtocolFeeController], ["BinProtocolFeeController", ADDR.binProtocolFeeController]]) {
    await renounce(n, a, ABI.ProtocolFeeController, safe, {
      title: `${n} (not installed): renounce is live; the contract becomes permanently unconfigurable`,
      bricked: async (ev) => {
        const x = await rec.send({ from: safe, to: a, abi: ABI.ProtocolFeeController, fn: "setProtocolFeeSplitRatio", args: [1n], contract: n, role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
        ev.setterAfter = x.error;
      },
    });
  }
  await renounce("CLPositionDescriptorOffChain", ADDR.clPositionDescriptor, ABI.CLPositionDescriptorOffChain, ADDR.timelockPolicy, {
    title: "Descriptor: renounce is live (owner = policy timelock); metadata URI frozen forever (cosmetic)",
    note: "executed AS the policy timelock (equivalent to an executed 6 h op)",
    bricked: async (ev) => {
      const x = await rec.send({ from: ADDR.timelockPolicy, to: ADDR.clPositionDescriptor, abi: ABI.CLPositionDescriptorOffChain, fn: "setBaseTokenURI", args: ["x"], contract: "CLPositionDescriptorOffChain", role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
      ev.setterAfter = x.error;
    },
  });
  await renounce("Create3Factory", ADDR.create3Factory, ABI.Create3Factory, opsKey, {
    title: "Create3Factory (owner = ops key): renounce is live; whitelist frozen (the ops key stays whitelisted)",
    bricked: async (ev) => {
      const x = await rec.send({ from: opsKey, to: ADDR.create3Factory, abi: ABI.Create3Factory, fn: "setWhitelistUser", args: [bob, true], contract: "Create3Factory", role: "hazard", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
      ev.setWhitelistAfter = x.error;
    },
  });
  rec.note("Contracts with no renounceOwnership at all: LatchTimelock x2 (AccessControl, self-administered), LatchRegistry (renounceRole(admin) refused - tested in phase registry), LatchLaunchRegistry, LaunchpadKit, LaunchGuardHook, CL/Bin quoters and position managers.");
}
