// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {LatchLaunchRegistry} from "../src/LatchLaunchRegistry.sol";

/**
 * Deploys `LatchLaunchRegistry` — the shared index of tokens launched through any Latch-based
 * launchpad.
 *
 * ONE SCRIPT, NOT TWO. `LatchRegistry` needs a testnet variant and a mainnet variant because it
 * takes role holders as constructor arguments, and the sensible testnet default (deployer holds
 * everything) is a bad mainnet one. This contract takes NO role holders: it reads `CURATOR_ROLE`
 * and `GUARDIAN_ROLE` off the Latch registry, so whichever registry you point it at, its
 * governance is already whatever that registry's governance is. There is nothing here to get
 * wrong differently per environment.
 *
 * THE TWO ADDRESSES, and why both are asserted rather than accepted.
 *
 *   REGISTRY_VAULT -> the LatchProtocol Vault. The trust anchor: a pool manager is believed iff
 *     `vault.isAppRegistered(manager)`, which is onlyOwner on the 48h custody timelock. A wrong
 *     Vault here silently voids every pool proof this registry will ever record, and the field is
 *     immutable, so reading it back afterwards is too late.
 *
 *   LATCH_REGISTRY -> the live `LatchRegistry`. Supplies this contract's curator and guardian
 *     roles and receives the hook attestations it forwards.
 *
 * THE ASSERTION THAT MATTERS: the two must share a Vault. A launch registry anchored to Vault A
 * while its Latch registry is anchored to Vault B would look completely healthy — every view
 * answers, every role resolves — while attesting pools from one protocol and taking governance
 * from another. That is not a configuration anybody would notice from a block explorer.
 *
 * Usage:
 *   REGISTRY_VAULT=0x...        (the Vault)
 *   LATCH_REGISTRY=0x...        (the live LatchRegistry)
 *   REGISTRY_POOL_MANAGER=0x... (a live pool manager, to prove the Vault is the right one)
 *   forge script script/DeployLaunchRegistry.s.sol --rpc-url <chain> --broadcast --slow
 */
interface IVaultAppCheck {
    function isAppRegistered(address app) external view returns (bool);
}

interface ILatchRegistryCheck {
    function vault() external view returns (address);
    function CURATOR_ROLE() external view returns (bytes32);
    function GUARDIAN_ROLE() external view returns (bytes32);
    function latchCount() external view returns (uint256);
}

contract DeployLaunchRegistryScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address vault = vm.envAddress("REGISTRY_VAULT");
        address latchRegistry = vm.envAddress("LATCH_REGISTRY");
        address poolManager = vm.envAddress("REGISTRY_POOL_MANAGER");

        require(vault.code.length > 0, "REGISTRY_VAULT has no code");
        require(latchRegistry.code.length > 0, "LATCH_REGISTRY has no code");

        /* Prove the Vault is the real one BEFORE deploying against it. A Vault that does not know
           the live pool manager is either the wrong address or an impostor. */
        require(
            IVaultAppCheck(vault).isAppRegistered(poolManager),
            "REGISTRY_VAULT does not know REGISTRY_POOL_MANAGER - wrong Vault"
        );

        /* And prove the two registries are anchored to the same protocol. */
        require(ILatchRegistryCheck(latchRegistry).vault() == vault, "LATCH_REGISTRY is anchored to a different Vault");

        vm.startBroadcast(pk);
        LatchLaunchRegistry registry = new LatchLaunchRegistry(vault, latchRegistry);
        vm.stopBroadcast();

        /* Assert the deployed reality, not the intent. */
        require(address(registry.vault()) == vault, "vault not wired");
        require(address(registry.latchRegistry()) == latchRegistry, "latch registry not wired");
        require(
            registry.CURATOR_ROLE() == ILatchRegistryCheck(latchRegistry).CURATOR_ROLE(),
            "curator role hash diverged from the Latch registry"
        );
        require(
            registry.GUARDIAN_ROLE() == ILatchRegistryCheck(latchRegistry).GUARDIAN_ROLE(),
            "guardian role hash diverged from the Latch registry"
        );

        console.log("LatchLaunchRegistry ", address(registry));
        console.log("  vault             ", vault);
        console.log("  latchRegistry     ", latchRegistry);
        console.log("  latches listed    ", ILatchRegistryCheck(latchRegistry).latchCount());
        console.log("  launches indexed  ", registry.launchCount());
        console.log("  This contract holds no roles of its own; curation is the Latch registry's.");
    }
}
