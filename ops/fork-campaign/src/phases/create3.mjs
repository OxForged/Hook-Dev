// SPDX-License-Identifier: MIT
// Create3Factory 0x6ffd (owner = ops key 0x304b) and CLPositionDescriptorOffChain 0x0af0
// (plain single-step Ownable, owner = the POLICY timelock 0x1Da3).
import { keccak256, encodeDeployData, toHex, encodeFunctionData } from "viem";
import { ADDR } from "../addresses.mjs";
import { artifact } from "../abis.mjs";
import { ABI, ACTORS, ZERO32 } from "../lib.mjs";

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, mallory } = ACTORS;
  const { opsKey, create3Factory: C3, clPositionDescriptor: DESC, timelockPolicy: POLICY, clPositionManager: POSM } = ADDR;
  const F = ABI.Create3Factory, D = ABI.CLPositionDescriptorOffChain, T = artifact("helpers/CampaignToken");

  rec.scenario("Create3Factory", "setWhitelistUser x3, deploy x3 (whitelisted), ownership x3");
  rec.assert("Create3Factory owner is the ops key (not in CLAUDE.md's ownership table)", await chain.read(C3, F, "owner"), opsKey);
  for (const [u, w] of [[alice, true], [bob, true], [carol, false]]) await rec.send({ from: opsKey, to: C3, abi: F, fn: "setWhitelistUser", args: [u, w], contract: "Create3Factory" });
  await rec.send({ from: mallory, to: C3, abi: F, fn: "setWhitelistUser", args: [mallory, true], contract: "Create3Factory", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  for (const [i, who] of [alice, bob, opsKey].entries()) {
    const code = encodeDeployData({ abi: T.abi, bytecode: T.bytecode, args: [`C3 ${i}`, `C3${i}`, 18] });
    const salt = keccak256(toHex(`c3-${i}`));
    const predicted = await chain.read(C3, F, "computeAddress", [salt]);
    await rec.send({ from: who, to: C3, abi: F, fn: "deploy", args: [salt, code, keccak256(code), 0n, "0x", 0n], contract: "Create3Factory", note: `CREATE3 deploy #${i + 1}` });
    rec.assert(`deploy #${i + 1} landed at computeAddress(salt)`, ((await chain.code(predicted)).length > 2), true);
  }
  await rec.send({ from: carol, to: C3, abi: F, fn: "deploy", args: [ZERO32, "0x00", keccak256("0x00"), 0n, "0x", 0n], contract: "Create3Factory", role: "unauthorized", expect: "revert", expectError: "NotWhitelisted" });
  await rec.send({ from: alice, to: C3, abi: F, fn: "deploy", args: [keccak256(toHex("c3-0")), "0x00", keccak256("0x00"), 0n, "0x", 0n], contract: "Create3Factory", role: "unauthorized", expect: "revert", note: "salt already used" });
  for (const nominee of [alice, bob, ADDR.safe]) {
    const s = await chain.snapshot();
    await rec.send({ from: opsKey, to: C3, abi: F, fn: "transferOwnership", args: [nominee], contract: "Create3Factory" });
    if (nominee === alice) await rec.send({ from: mallory, to: C3, abi: F, fn: "acceptOwnership", contract: "Create3Factory", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    await rec.send({ from: nominee, to: C3, abi: F, fn: "acceptOwnership", contract: "Create3Factory" });
    await chain.revert(s);
  }
  await rec.send({ from: mallory, to: C3, abi: F, fn: "transferOwnership", args: [mallory], contract: "Create3Factory", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });

  rec.scenario("CLPositionDescriptorOffChain", "owner is the policy timelock: setters x3 executed AS the timelock (impersonated, equivalent to an executed 6 h op) and once through a real schedule->execute");
  rec.assert("descriptor owner is the policy timelock", await chain.read(DESC, D, "owner"), POLICY);
  for (const uri of ["https://example.invalid/a/", "ipfs://campaign/", ""]) await rec.send({ from: POLICY, to: DESC, abi: D, fn: "setBaseTokenURI", args: [uri], contract: "CLPositionDescriptorOffChain" });
  for (const c of [alice, ZERO32.slice(0, 42), DESC]) await rec.send({ from: POLICY, to: DESC, abi: D, fn: "setTokenURIContract", args: [c], contract: "CLPositionDescriptorOffChain", note: c === DESC ? "points at itself: tokenURI now recurses until out of gas (cosmetic DoS a policy key can cause)" : undefined });
  const tu = await chain.tryRead(DESC, D, "tokenURI", [POSM, 1n]);
  rec.note("tokenURI with tokenURIContract = self", { ok: tu.ok });
  await rec.send({ from: POLICY, to: DESC, abi: D, fn: "setTokenURIContract", args: ["0x0000000000000000000000000000000000000000"], contract: "CLPositionDescriptorOffChain", role: "setup" });
  await rec.send({ from: mallory, to: DESC, abi: D, fn: "setBaseTokenURI", args: ["x"], contract: "CLPositionDescriptorOffChain", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  await rec.send({ from: ADDR.safe, to: DESC, abi: D, fn: "setTokenURIContract", args: [alice], contract: "CLPositionDescriptorOffChain", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount", note: "the Safe does not own it (the table says Safe; the chain says policy timelock)" });
  // one real queued op
  const TL = ABI.LatchTimelock_policy;
  const data = encodeFunctionData({ abi: D, functionName: "setBaseTokenURI", args: ["https://latch.invalid/queued/"] });
  const salt = keccak256(toHex("desc-queued"));
  await rec.send({ from: ADDR.safe, to: POLICY, abi: TL, fn: "schedule", args: [DESC, 0n, data, ZERO32, salt, 21600n], contract: "LatchTimelock_policy", note: "queue setBaseTokenURI on the descriptor" });
  await chain.warp(21601n);
  await rec.send({ from: bob, to: POLICY, abi: TL, fn: "execute", args: [DESC, 0n, data, ZERO32, salt], contract: "LatchTimelock_policy", note: "executed after 6 h" });
  rec.assert("queued setBaseTokenURI took effect", await chain.read(DESC, D, "tokenURI", [POSM, 7n]), "https://latch.invalid/queued/7");
  for (const nominee of [alice, ADDR.safe, bob]) {
    const s = await chain.snapshot();
    await rec.send({ from: POLICY, to: DESC, abi: D, fn: "transferOwnership", args: [nominee], contract: "CLPositionDescriptorOffChain", note: "SINGLE-step Ownable: takes effect immediately, no accept" });
    rec.assert(`descriptor owner == ${nominee} immediately`, await chain.read(DESC, D, "owner"), nominee);
    await chain.revert(s);
  }
  await rec.send({ from: mallory, to: DESC, abi: D, fn: "transferOwnership", args: [mallory], contract: "CLPositionDescriptorOffChain", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
}
