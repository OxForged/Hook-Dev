// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {IBinPoolManager} from "infinity-core/src/pool-bin/interfaces/IBinPoolManager.sol";
import {ILaunchTokenOrigin} from "latch-hooks/src/launch/LaunchGuardHook.sol";
import {BinLaunchGuardHook} from "latch-hooks/src/launch/BinLaunchGuardHook.sol";
import {ContractClockProbe} from "latch-hooks/script/ContractClock.sol";
import {LatchRegistry} from "latch-registry/src/LatchRegistry.sol";
import {LatchMetadata} from "latch-registry/src/ILatchRegistry.sol";

/**
 * Deploys `BinLaunchGuardHook` WITH the pool-id reservation (ported 2026-09-14) and lists it in the
 * registry in the same session. Kit v2 needs it: `LaunchpadKitV2`'s constructor refuses a Bin guard whose
 * `LAUNCH_TOKEN_FACTORY` is not the kit's factory.
 *
 * No Bin guard is deployed on any chain today, so nothing migrates. The factory is IMMUTABLE on the hook and
 * REQUIRED here (`vm.envAddress` fails loudly when unset): a Bin guard without it would let anybody squat a
 * kit's Bin launch pools, which is the open LOW this deployment closes.
 *
 * No owner, no guardian, no admin (CLAUDE.md Ownership table, "Contracts with no privileged role"). The
 * listing steward is the Ops key, as for `LaunchGuardHook`.
 *
 * Usage (dry run first - no --broadcast):
 *   BIN_POOL_MANAGER=0x... LAUNCH_TOKEN_FACTORY=0x... LAUNCH_GUARD_REGISTRY=0x... LAUNCH_GUARD_STEWARD=<ops> \
 *   forge script script/DeployBinLaunchGuardHook.s.sol --rpc-url $ROBINHOOD_RPC
 */
contract DeployBinLaunchGuardHookScript is Script {
    /// @dev bit 0 beforeInitialize | bit 2 beforeMint | bit 6 beforeSwap. Duplicated from the kit on purpose.
    uint16 internal constant EXPECTED_BITMAP = 0x0045;

    string internal constant SOURCE_URI =
        "https://github.com/OxForged/Hook-Dev/blob/main/packages/hooks/src/launch/BinLaunchGuardHook.sol";

    function run() public returns (BinLaunchGuardHook hook) {
        ContractClockProbe.Reading memory clock = ContractClockProbe.check();
        console.log("chain clock: block.timestamp (EVM) ", clock.evmTimestamp);
        return runWith(
            vm.envUint("PRIVATE_KEY"),
            vm.envAddress("BIN_POOL_MANAGER"),
            vm.envAddress("LAUNCH_TOKEN_FACTORY"),
            vm.envAddress("LAUNCH_GUARD_REGISTRY"),
            vm.envAddress("LAUNCH_GUARD_STEWARD")
        );
    }

    function runWith(uint256 pk, address binPoolManager, address factory, address registry, address steward)
        public
        returns (BinLaunchGuardHook hook)
    {
        address deployer = vm.addr(pk);
        require(binPoolManager.code.length > 0, "BIN_POOL_MANAGER has no code");
        require(factory != address(0) && factory.code.length > 0, "LAUNCH_TOKEN_FACTORY has no code");
        require(ILaunchTokenOrigin(factory).deployerOf(address(this)) == address(0), "LAUNCH_TOKEN_FACTORY is not a factory");
        (bool ok, bytes memory ret) = factory.staticcall(abi.encodeWithSignature("launchTokenInitCodeHash()"));
        require(ok && ret.length == 32 && bytes32(ret) != bytes32(0), "LAUNCH_TOKEN_FACTORY has no init code hash");
        require(registry.code.length > 0, "LAUNCH_GUARD_REGISTRY has no code");
        require(steward != address(0), "LAUNCH_GUARD_STEWARD unset - Ops");
        LatchRegistry(registry).latchCount();

        uint256[] memory chains = new uint256[](1);
        chains[0] = block.chainid;

        vm.startBroadcast(pk);
        hook = new BinLaunchGuardHook(IBinPoolManager(binPoolManager), ILaunchTokenOrigin(factory));
        LatchRegistry(registry).register(
            address(hook),
            LatchMetadata({
                name: "BinLaunchGuard",
                description: "Decaying sniper tax for Bin pools, on block.timestamp; launch pools reserved for the token's creator.",
                sourceURI: SOURCE_URI,
                auditURI: "",
                chainIds: chains
            })
        );
        if (steward != deployer) LatchRegistry(registry).transferSteward(address(hook), steward);
        vm.stopBroadcast();

        require(address(hook.poolManager()) == binPoolManager, "hook: poolManager");
        require(address(hook.LAUNCH_TOKEN_FACTORY()) == factory, "hook: LAUNCH_TOKEN_FACTORY");
        require(hook.getHooksRegistrationBitmap() == EXPECTED_BITMAP, "hook: bitmap");
        require(keccak256(bytes(hook.CLOCK_MODE())) == keccak256("mode=timestamp"), "hook: clock");
        require(hook.MAX_INITIAL_FEE() == 100_000 && hook.MAX_FINAL_FEE() == 20_000, "hook: fee caps moved");
        require(hook.MIN_DECAY_SECONDS() == 60 && hook.MAX_DECAY_SECONDS() == 30 days, "hook: decay bounds moved");
        require(hook.MAX_START_DELAY_SECONDS() == 30 days, "hook: start delay moved");
        LatchRegistry reg = LatchRegistry(registry);
        require(reg.isRegistered(address(hook)), "hook was not listed");
        require(reg.getLatch(address(hook)).submitter == deployer, "someone else listed this hook first");
        require(reg.getLatch(address(hook)).steward == steward, "listing steward is not the Ops steward");

        console.log("BinLaunchGuardHook      ", address(hook));
        console.log("  LAUNCH_TOKEN_FACTORY  ", factory);
        console.log("No owner, no guardian, no admin. NEXT: export BIN_LAUNCH_GUARD_HOOK=<address above>");
    }
}
