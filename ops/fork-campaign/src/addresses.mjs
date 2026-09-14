// SPDX-License-Identifier: MIT
// Addresses come from the SDK address book (packages/sdk/src/deployments/index.ts, chain 4663).
// Only values the address book deliberately does not carry are added here, each with its source.
import { getAddress } from "viem";
import { LATCH_DEPLOYMENTS } from "../../../packages/sdk/src/deployments/index.ts";

const d = LATCH_DEPLOYMENTS[4663];
const A = (x) => getAddress(x);

export const ADDR = {
  vault: A(d.vault),
  clPoolManager: A(d.clPoolManager),
  binPoolManager: A(d.binPoolManager),
  clPoolManagerOwner: A(d.clPoolManagerOwner),
  binPoolManagerOwner: A(d.binPoolManagerOwner),
  feeControllerV2: A(d.feeController),
  clProtocolFeeController: A(d.clProtocolFeeController),
  binProtocolFeeController: A(d.binProtocolFeeController),
  safe: A(d.governanceSafe),
  timelockCustody: A(d.timelockCustody),
  timelockPolicy: A(d.timelockPolicy),
  registry: A(d.registry),
  launchRegistry: A(d.launchRegistry),
  universalRouter: A(d.universalRouter),
  clPositionManager: A(d.clPositionManager),
  binPositionManager: A(d.binPositionManager),
  clQuoter: A(d.clQuoter),
  binQuoter: A(d.binQuoter),
  clPositionDescriptor: A(d.clPositionDescriptor),
  create3Factory: A(d.create3Factory),
  permit2: A(d.permit2),
  weth: A(d.weth),
  revShareHookCurrent: A(d.revShareHook),
  launchpadKit: A(d.launchpadKit),
  launchGuardHook: A(d.launchGuardHook),
  ltt1: A(d.tokens.find((t) => t.symbol === "LTT1").address),
  ltt2: A(d.tokens.find((t) => t.symbol === "LTT2").address),
  demoPoolId: d.demoPool.id,

  // --- not in the address book, sourced from CLAUDE.md / memory notes ---
  /** Retired RevShareHook that still hosts LTT1/LTT2 (CLAUDE.md "Deployed and unfixable"; index.ts comment). */
  revShareHookRetired: A("0x23CE34E8199927DD270dddd8579c947542bDE446"),
  /** Ops key: deployer / keeper / guardian / publisher (CLAUDE.md "One wallet, four roles"). */
  opsKey: A("0x304b0cc019CDBA6C7c767D86a2A34e69FDb3c9a9"),
  /** Sole CANCELLER_ROLE on the custody timelock (CLAUDE.md "The canceller"). */
  canceller: A("0xe65F304e40b61d7417154cb3e725C0Ee16701142"),
  /** Robinhood stock token (memory: robinhood-stock-tokens-onchain-facts). */
  nvda: A("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"),
  /** Suggested NVDA holder: the Uniswap v4 PoolManager on 4663 (CLAUDE.md "Infinity-only"). Impersonated on the fork only. */
  nvdaHolder: A("0x8366a39cc670b4001a1121b8f6a443a643e40951"),
  /** Stock beacon / ACCESS_CONTROLLED_REGISTRY (memory note). */
  stockBeacon: A("0xe10b6f6B275de231345c20D14Ab812db62151b00"),
  /** Retired contracts, recorded only so the report can say they were not exercised. */
  retiredRegistry: A("0xE4395085De89365440A6Ee25cE24BE2bAD66AC86"),
  retiredCustodyTimelock: A("0x63F08A697Cc003d5eA61787712C34438559a7428"),
  retiredFeeControllerV1: A("0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c"),
};

/** The three acceptOwnership operations already queued on the custody timelock (coordinator, 2026-09-13). */
export const QUEUED_ACCEPTS = {
  queuedAtBlock: 61_325_176,
  readyAt: 1_789_411_243n,
  ops: [
    { name: "Vault", target: ADDR.vault, salt: "0xe17bfec589d6a2594c2d59f7a1455e637425f2d5a4cbbcdf9062e39fad16e555" },
    { name: "CLPoolManagerOwner", target: ADDR.clPoolManagerOwner, salt: "0xb0ecc7113374d7c91a718f0d7a67a59bbf2efaaaf0f6c3a209b541cb4e3de097" },
    { name: "BinPoolManagerOwner", target: ADDR.binPoolManagerOwner, salt: "0x4787d44da9b61fa3107ab9bd0ef45f807be8debdaa46b66a2ae96ceb458a62c1" },
  ],
};

/** Contract name -> [address, artifact] for bytecode verification and the view sweep. */
export const DEPLOYED = [
  ["Vault", ADDR.vault, "Vault"],
  ["CLPoolManager", ADDR.clPoolManager, "CLPoolManager"],
  ["BinPoolManager", ADDR.binPoolManager, "BinPoolManager"],
  ["CLPoolManagerOwner", ADDR.clPoolManagerOwner, "CLPoolManagerOwner"],
  ["BinPoolManagerOwner", ADDR.binPoolManagerOwner, "BinPoolManagerOwner"],
  ["CLProtocolFeeController", ADDR.clProtocolFeeController, "ProtocolFeeController"],
  ["BinProtocolFeeController", ADDR.binProtocolFeeController, "ProtocolFeeController"],
  ["LatchProtocolFeeControllerV2", ADDR.feeControllerV2, "LatchProtocolFeeControllerV2"],
  ["Create3Factory", ADDR.create3Factory, "Create3Factory"],
  ["LatchTimelock_custody", ADDR.timelockCustody, "LatchTimelock"],
  ["LatchTimelock_policy", ADDR.timelockPolicy, "LatchTimelock_policy"],
  ["LatchRegistry", ADDR.registry, "LatchRegistry"],
  ["LatchLaunchRegistry", ADDR.launchRegistry, "LatchLaunchRegistry"],
  ["UniversalRouter", ADDR.universalRouter, "UniversalRouter"],
  ["CLPositionManager", ADDR.clPositionManager, "CLPositionManager"],
  ["BinPositionManager", ADDR.binPositionManager, "BinPositionManager"],
  ["CLQuoter", ADDR.clQuoter, "CLQuoter"],
  ["BinQuoter", ADDR.binQuoter, "BinQuoter"],
  ["CLPositionDescriptorOffChain", ADDR.clPositionDescriptor, "CLPositionDescriptorOffChain"],
  ["LaunchpadKit", ADDR.launchpadKit, "LaunchpadKit"],
  ["LaunchGuardHook", ADDR.launchGuardHook, "LaunchGuardHook"],
  ["RevShareHook_fC00", ADDR.revShareHookCurrent, "RevShareHook_fC00"],
  ["RevShareHook_23CE", ADDR.revShareHookRetired, "RevShareHook_23CE"],
];
