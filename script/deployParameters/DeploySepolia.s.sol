// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.15;

import {DeployUniversalRouter} from "../DeployUniversalRouter.s.sol";
import {RouterParameters} from "../../src/base/RouterImmutables.sol";

/**
 * UniversalRouter for Latch Protocol on Ethereum Sepolia (11155111).
 *
 * Only the Latch (infi*) legs are wired. The v2 / v3 / stable legs are left at
 * address(0), which the base script maps to UnsupportedProtocol — Latch has no v2 or
 * v3 deployment on Sepolia, and pointing them at PancakeSwap's would route users into
 * a different protocol's pools.
 */
contract DeploySepolia is DeployUniversalRouter {
    function setUp() public override {
        params = RouterParameters({
            permit2: 0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768,
            weth9: 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14,
            v2Factory: address(0),
            v3Factory: address(0),
            v3Deployer: address(0),
            v2InitCodeHash: bytes32(0),
            v3InitCodeHash: bytes32(0),
            stableFactory: address(0),
            stableInfo: address(0),
            infiVault: 0xCe3d133eb486b448A53437A5073619FbE424d01B,
            infiClPoolManager: 0xb7C8a11E0B359616eD06256783aF57114841F738,
            infiBinPoolManager: 0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3
        });
        unsupported = address(0);
    }

    function getDeploymentSalt() public pure override returns (bytes32) {
        return keccak256("LATCH-UNIVERSAL-ROUTER/1.0.0");
    }
}
