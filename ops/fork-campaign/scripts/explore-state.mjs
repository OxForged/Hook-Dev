// SPDX-License-Identifier: MIT
// Read-only snapshot of the live governance state as the fork sees it. No transactions.
// Usage: node scripts/explore-state.mjs [rpc]
import { parseAbi, keccak256, toHex, encodeAbiParameters } from "viem";
import { connect } from "../src/chain.mjs";
import { artifact, ERC20_ABI } from "../src/abis.mjs";
import { ADDR, QUEUED_ACCEPTS } from "../src/addresses.mjs";

const chain = await connect(process.argv[2] ?? "http://127.0.0.1:8547");
await chain.prime();
const r = async (label, addr, abi, fn, args = []) => {
  const x = await chain.tryRead(addr, abi, fn, args);
  console.log(label.padEnd(58), x.ok ? JSON.stringify(x.value, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : `REVERT ${String(x.error).slice(0, 80)}`);
  return x.ok ? x.value : undefined;
};
const OWN = parseAbi(["function owner() view returns (address)", "function pendingOwner() view returns (address)"]);
for (const [n, a] of Object.entries({ vault: ADDR.vault, clOwner: ADDR.clPoolManagerOwner, binOwner: ADDR.binPoolManagerOwner, fcV2: ADDR.feeControllerV2, clPFC: ADDR.clProtocolFeeController, binPFC: ADDR.binProtocolFeeController, router: ADDR.universalRouter, desc: ADDR.clPositionDescriptor, create3: ADDR.create3Factory, rsh23: ADDR.revShareHookRetired, rshfC: ADDR.revShareHookCurrent })) {
  await r(`${n}.owner`, a, OWN, "owner");
  await r(`${n}.pendingOwner`, a, OWN, "pendingOwner");
}
await r("clManager.owner", ADDR.clPoolManager, artifact("CLPoolManager").abi, "owner");
await r("binManager.owner", ADDR.binPoolManager, artifact("BinPoolManager").abi, "owner");
await r("clManager.protocolFeeController", ADDR.clPoolManager, artifact("CLPoolManager").abi, "protocolFeeController");
await r("clManager.paused", ADDR.clPoolManager, artifact("CLPoolManager").abi, "paused");
await r("clOwner.hasPausableRole(ops)", ADDR.clPoolManagerOwner, artifact("CLPoolManagerOwner").abi, "hasPausableRole", [ADDR.opsKey]);
await r("binOwner.hasPausableRole(ops)", ADDR.binPoolManagerOwner, artifact("BinPoolManagerOwner").abi, "hasPausableRole", [ADDR.opsKey]);
await r("vault.isAppRegistered(cl)", ADDR.vault, artifact("Vault").abi, "isAppRegistered", [ADDR.clPoolManager]);
await r("vault.isAppRegistered(bin)", ADDR.vault, artifact("Vault").abi, "isAppRegistered", [ADDR.binPoolManager]);
await r("fcV2.treasury", ADDR.feeControllerV2, artifact("LatchProtocolFeeControllerV2").abi, "treasury");
await r("fcV2.guardian", ADDR.feeControllerV2, artifact("LatchProtocolFeeControllerV2").abi, "guardian");
const TL = artifact("LatchTimelock").abi;
for (const [n, a] of [["custody", ADDR.timelockCustody], ["policy", ADDR.timelockPolicy]]) {
  await r(`${n}.getMinDelay`, a, TL, "getMinDelay");
  for (const role of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"]) {
    const id = await chain.read(a, TL, role);
    await r(`${n}.${role}(safe)`, a, TL, "hasRole", [id, ADDR.safe]);
    await r(`${n}.${role}(canceller)`, a, TL, "hasRole", [id, ADDR.canceller]);
    await r(`${n}.${role}(0x0)`, a, TL, "hasRole", [id, "0x0000000000000000000000000000000000000000"]);
  }
}
for (const op of QUEUED_ACCEPTS.ops) {
  const id = await chain.read(ADDR.timelockCustody, TL, "hashOperation", [op.target, 0n, "0x79ba5097", "0x0000000000000000000000000000000000000000000000000000000000000000", op.salt]);
  await r(`queued ${op.name} ts`, ADDR.timelockCustody, TL, "getTimestamp", [id]);
  await r(`queued ${op.name} state`, ADDR.timelockCustody, TL, "getOperationState", [id]);
}
const REG = artifact("LatchRegistry").abi;
for (const role of ["DEFAULT_ADMIN_ROLE", "CURATOR_ROLE", "GUARDIAN_ROLE"]) {
  const id = await chain.read(ADDR.registry, REG, role);
  await r(`registry.${role}(safe)`, ADDR.registry, REG, "hasRole", [id, ADDR.safe]);
  await r(`registry.${role}(ops)`, ADDR.registry, REG, "hasRole", [id, ADDR.opsKey]);
}
await r("registry.latchCount", ADDR.registry, REG, "latchCount");
await r("registry.adminCount", ADDR.registry, REG, "adminCount");
await r("launchRegistry.launchCount", ADDR.launchRegistry, artifact("LatchLaunchRegistry").abi, "launchCount");
const R23 = artifact("RevShareHook_23CE").abi;
await r("rsh23.guardian", ADDR.revShareHookRetired, R23, "guardian");
await r("rsh23.paused", ADDR.revShareHookRetired, R23, "paused");
await r("rsh23.poolOwner(demo)", ADDR.revShareHookRetired, R23, "poolOwner", [ADDR.demoPoolId]);
await r("rsh23.getConfig(demo)", ADDR.revShareHookRetired, R23, "getConfig", [ADDR.demoPoolId]);
await r("rsh23.getBeneficiaries(demo)", ADDR.revShareHookRetired, R23, "getBeneficiaries", [ADDR.demoPoolId]);
await r("rsh23.keyOf(demo)", ADDR.revShareHookRetired, R23, "keyOf", [ADDR.demoPoolId]);
await r("rsh23.pendingBeneficiary(demo,ltt1)", ADDR.revShareHookRetired, R23, "pendingBeneficiary", [ADDR.demoPoolId, ADDR.ltt1]);
await r("rsh23.pendingBeneficiary(demo,ltt2)", ADDR.revShareHookRetired, R23, "pendingBeneficiary", [ADDR.demoPoolId, ADDR.ltt2]);
await r("rsh23.getPendingConfig(demo)", ADDR.revShareHookRetired, R23, "getPendingConfig", [ADDR.demoPoolId]);
const RfC = artifact("RevShareHook_fC00").abi;
for (const f of ["guardian", "paused", "CONFIG_DELAY_BLOCKS", "CONFIG_PROPOSAL_TTL_BLOCKS", "blockTimeCentis", "MAX_BENEFICIARIES"]) await r(`rshfC.${f}`, ADDR.revShareHookCurrent, RfC, f);
const CL = artifact("CLPoolManager").abi;
await r("cl.getSlot0(demo)", ADDR.clPoolManager, CL, "getSlot0", [ADDR.demoPoolId]);
await r("cl.getLiquidity(demo)", ADDR.clPoolManager, CL, "getLiquidity", [ADDR.demoPoolId]);
await r("cl.poolIdToPoolKey(demo)", ADDR.clPoolManager, CL, "poolIdToPoolKey", [ADDR.demoPoolId]);
for (const [n, t] of [["ltt1", ADDR.ltt1], ["ltt2", ADDR.ltt2], ["nvda", ADDR.nvda]]) {
  await r(`${n}.balanceOf(ops)`, t, ERC20_ABI, "balanceOf", [ADDR.opsKey]);
  await r(`${n}.totalSupply`, t, ERC20_ABI, "totalSupply");
}
await r("nvda.balanceOf(holder)", ADDR.nvda, ERC20_ABI, "balanceOf", [ADDR.nvdaHolder]);
console.log("ltt1 code bytes", ((await chain.code(ADDR.ltt1)).length - 2) / 2);
const LGH = artifact("LaunchGuardHook").abi;
for (const f of ["blockTimeCentis", "MAX_DECAY_BLOCKS", "MAX_START_DELAY"]) await r(`lgh.${f}`, ADDR.launchGuardHook, LGH, f);
await r("kit.blockTimeCentis", ADDR.launchpadKit, artifact("LaunchpadKit").abi, "blockTimeCentis");
await r("kit.registry", ADDR.launchpadKit, artifact("LaunchpadKit").abi, "registry");
await r("kit.positionManager", ADDR.launchpadKit, artifact("LaunchpadKit").abi, "positionManager");
console.log("evmClock", await chain.evmClock(), "head", await chain.head());
