// SPDX-License-Identifier: MIT
/**
 * Emits the launchpad ABIs the SDK's `launchpad` module encodes calldata against.
 *
 * Same licence firewall as `generate-events.mjs`: this reads the *ABI JSON* out of
 * the Foundry build artifacts of the GPL-licensed Solidity packages and emits
 * MIT-licensed TypeScript. It never reads Solidity sources, comments or NatSpec,
 * so nothing expressive crosses the boundary - an ABI is a machine-generated
 * interface description, which is exactly what an MIT consumer is entitled to
 * build against without inheriting the GPL of the implementation behind it.
 *
 * Usage: node scripts/generate-launchpad-abi.mjs [--check]
 */

import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { emitModule, renderAbiModule } from "./lib/curated-abi.mjs";

const SCRIPT = "generate-launchpad-abi.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const REPO_PACKAGES = resolve(PKG_ROOT, "..");
const OUT_FILE = join(PKG_ROOT, "src", "launchpad", "generated", "abi.ts");

/**
 * Each entry names one exported constant and the artifact it is read from.
 * Only the members the SDK actually encodes or decodes are kept, so the emitted
 * file stays reviewable rather than being a dump of every internal getter.
 *
 * Every name below is checked against the artifact; a rename upstream fails the
 * generator instead of quietly shrinking the emitted ABI.
 */
const SOURCES = [
  {
    constant: "LAUNCHPAD_KIT_ABI",
    doc: "`LaunchpadKit` - the one-call launch factory.",
    contract: "LaunchpadKit",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LaunchpadKit.sol", "LaunchpadKit.json"),
    keep: {
      function: [
        "createLaunch",
        "reconfigureLaunch",
        "computePoolKey",
        "previewSchedule",
        "getLaunchRecord",
        "listHook",
        "hook",
        "clPoolManager",
        "positionManager",
        "permit2",
        "registry",
        "hookBitmap",
        "EXPECTED_HOOK_BITMAP",
        "CLOCK_MODE",
      ],
      event: ["LaunchCreated", "LaunchSeeded", "LaunchReconfigured", "HookListed"],
      error: null, // keep every error: they are the diagnostic surface
    },
  },
  {
    constant: "LAUNCH_GUARD_HOOK_ABI",
    doc: "`LaunchGuardHook` - the CL launch hook the kit drives.",
    contract: "LaunchGuardHook",
    artifact: join(REPO_PACKAGES, "hooks", "foundry-out", "LaunchGuardHook.sol", "LaunchGuardHook.json"),
    keep: {
      function: [
        "configureLaunch",
        "getLaunch",
        "launchOwner",
        "feeAt",
        "currentFee",
        "getHooksRegistrationBitmap",
        "poolManager",
        "MAX_INITIAL_FEE",
        "MAX_FINAL_FEE",
        "MIN_DECAY_SECONDS",
        "MAX_DECAY_SECONDS",
        "MAX_START_DELAY_SECONDS",
        "CLOCK_MODE",
        "clock",
        "LAUNCH_TOKEN_FACTORY",
        "launchClaimerOf",
        "setLaunchClaimer",
      ],
      event: ["LaunchClaimed", "LaunchConfigured", "LaunchStarted", "LaunchClaimerSet"],
      error: null,
    },
  },
  {
    constant: "BIN_LAUNCH_GUARD_HOOK_ABI",
    doc: "`BinLaunchGuardHook` - the liquidity-book variant, including `beforeMint`.",
    contract: "BinLaunchGuardHook",
    artifact: join(REPO_PACKAGES, "hooks", "foundry-out", "BinLaunchGuardHook.sol", "BinLaunchGuardHook.json"),
    keep: {
      function: [
        "configureLaunch",
        "getLaunch",
        "launchOwner",
        "feeAt",
        "currentFee",
        "getHooksRegistrationBitmap",
        "poolManager",
        "MAX_INITIAL_FEE",
        "MAX_FINAL_FEE",
        "MIN_DECAY_SECONDS",
        "MAX_DECAY_SECONDS",
        "MAX_START_DELAY_SECONDS",
        "CLOCK_MODE",
        "clock",
        "LAUNCH_TOKEN_FACTORY",
        "launchClaimerOf",
        "setLaunchClaimer",
      ],
      event: ["LaunchClaimed", "LaunchConfigured", "LaunchStarted", "LaunchClaimerSet"],
      error: null,
    },
  },
  /* ---------------------------------------------------------------- kit v2 */
  {
    constant: "LAUNCHPAD_KIT_V2_ABI",
    doc: "`LaunchpadKitV2` - locked, multi-pool (CL and Bin) launches with a Safe-owned launch fee.",
    contract: "LaunchpadKitV2",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LaunchpadKitV2.sol", "LaunchpadKitV2.json"),
    keep: {
      function: [
        // launcher, operator, tenant
        "createLaunch",
        "reconfigureLaunch",
        "setTenantConfig",
        "setTenantQuote",
        "claimFees",
        // permissionless
        "flushProtocolFees",
        "registerLaunchpad",
        // owner (the Safe) - encoded for a Safe transaction, never sent by a keeper
        "setLaunchFee",
        "cancelPendingLaunchFee",
        // views
        "launchFeeWei",
        "pendingLaunchFee",
        "predictLaunchToken",
        "computeLegKey",
        "isLockedLaunch",
        "launchOriginOf",
        "getLeg",
        "getLaunch",
        "legsOf",
        "tenantConfig",
        "tenantQuoteAllowed",
        "feesOwed",
        "totalFeesOwed",
        "owner",
        "pendingOwner",
        "protocolFeeRecipient",
        "launchpadSteward",
        "maxLaunchFeeWei",
        "launchFeeNoticeSeconds",
        "maxIntegratorLaunchFeeWei",
        "maxLegs",
        "maxBinsPerLeg",
        "maxIntegratorBps",
        "tokenFactory",
        "launchRegistry",
        "clPoolManager",
        "binPoolManager",
        "clPositionManager",
        "binPositionManager",
        "clHook",
        "binHook",
        "clLocker",
        "binLocker",
        "CL_HOOK_BITMAP",
        "BIN_HOOK_BITMAP",
        "PROTOCOL_LP_FLOOR_BPS",
        "MAX_LEGS_HARD_CAP",
        "MIN_FEE_NOTICE_SECONDS",
        "MAX_FEE_NOTICE_SECONDS",
        "MAX_START_DELAY_SECONDS",
        "CLOCK_MODE",
      ],
      event: null,
      error: null,
    },
  },
  {
    constant: "LAUNCH_LEGS_ABI",
    doc:
      "`LaunchLegs` - the kit's linked library. Errors only: it runs by DELEGATECALL inside `createLaunch`, so " +
      "its reverts (every `BinShape*` rule R1-R6 among them) surface from the KIT's address. Merge it with " +
      "`LAUNCHPAD_KIT_V2_ABI` to decode a failed launch.",
    contract: "LaunchLegs",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LaunchLegs.sol", "LaunchLegs.json"),
    keep: { error: null },
  },
  {
    constant: "LAUNCH_TOKEN_FACTORY_ABI",
    doc: "`LaunchTokenFactory` - deterministic launch tokens; `launchTokenInitCodeHash` feeds off-chain prediction.",
    contract: "LaunchTokenFactory",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LaunchTokenFactory.sol", "LaunchTokenFactory.json"),
    keep: {
      function: [
        "predictTokenAddress",
        "launchTokenInitCodeHash",
        "isLaunchToken",
        "deployerOf",
        "MAX_NAME_BYTES",
        "MAX_SYMBOL_BYTES",
        "MAX_METADATA_URI_BYTES",
      ],
      event: null,
      error: null,
    },
  },
  {
    constant: "LATCH_LP_LOCKER_ABI",
    doc: "`LatchLPLocker` - the permanent CL position locker. `collectFees` and `skim` are permissionless.",
    contract: "LatchLPLocker",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchLPLocker.sol", "LatchLPLocker.json"),
    keep: {
      function: [
        "collectFees",
        "claim",
        "skim",
        "transferCreator",
        "acceptCreator",
        "claimable",
        "totalOwed",
        "getLock",
        "isLocked",
        "lockCount",
        "pendingCreator",
        "splitAmount",
        "positionManager",
        "vault",
        "protocolRecipient",
        "minProtocolBps",
        "maxProtocolBps",
        "maxIntegratorBps",
        "BPS_DENOMINATOR",
      ],
      event: null,
      error: null,
    },
  },
  {
    constant: "LATCH_BIN_LP_LOCKER_ABI",
    doc: "`LatchBinLPLocker` - the permanent Bin share locker. `collectFees` and `skim` are permissionless.",
    contract: "LatchBinLPLocker",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchBinLPLocker.sol", "LatchBinLPLocker.json"),
    keep: {
      function: [
        "lock",
        "collectFees",
        "claim",
        "skim",
        "transferCreator",
        "acceptCreator",
        "claimable",
        "totalOwed",
        "getLock",
        "getPoolKey",
        "getLockedBins",
        "previewCollect",
        "harvestableShares",
        "isLocked",
        "lockCount",
        "pendingCreator",
        "splitAmount",
        "positionManager",
        "binPoolManager",
        "vault",
        "protocolRecipient",
        "minProtocolBps",
        "maxProtocolBps",
        "maxIntegratorBps",
        "maxBinsPerLock",
        "BPS_DENOMINATOR",
        "MAX_BINS_HARD_CAP",
      ],
      event: null,
      error: null,
    },
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const checkOnly = process.argv.slice(2).includes("--check");
  const { contents, slices } = renderAbiModule(SCRIPT, SOURCES);

  const upToDate = emitModule(OUT_FILE, contents, checkOnly);

  if (checkOnly) {
    if (!upToDate) {
      console.error("Generated launchpad ABIs are stale. Run `npm run generate`.");
      process.exit(1);
    }
    console.log("launchpad ABIs are up to date.");
    return;
  }

  for (const { source, abi } of slices) {
    console.log(`  ${source.constant.padEnd(26)} ${String(abi.length).padStart(3)} members`);
  }
  const total = slices.reduce((n, s) => n + s.abi.length, 0);
  console.log(`generated ${total} ABI members into src/launchpad/generated/abi.ts`);
}

main();
