// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

/// @notice The custody-timelock operation that installs V3 on both pool-manager owner wrappers.
/// Pure encoding, shared by the script and its test. Design: docs/controller-v3.md section 6.3.
library InstallV3Calldata {
    /// `setProtocolFeeController(address)`
    bytes4 internal constant SET_PROTOCOL_FEE_CONTROLLER = 0x2d771389;
    /// `keccak256("latch.install.feeControllerV3")`, per the ops/safe salt convention.
    bytes32 internal constant SALT = keccak256("latch.install.feeControllerV3");
    bytes32 internal constant PREDECESSOR = bytes32(0);
    /// The custody tier. OZ rejects anything below `getMinDelay()`.
    uint256 internal constant CUSTODY_DELAY = 172_800;

    function batch(address clPoolManagerOwner, address binPoolManagerOwner, address v3)
        internal
        pure
        returns (address[] memory targets, uint256[] memory values, bytes[] memory payloads)
    {
        require(v3 != address(0), "V3 is the zero address: setProtocolFeeController(0) silently zeroes every new pool");
        targets = new address[](2);
        values = new uint256[](2);
        payloads = new bytes[](2);
        targets[0] = clPoolManagerOwner;
        targets[1] = binPoolManagerOwner;
        payloads[0] = abi.encodeWithSelector(SET_PROTOCOL_FEE_CONTROLLER, v3);
        payloads[1] = abi.encodeWithSelector(SET_PROTOCOL_FEE_CONTROLLER, v3);
    }

    function scheduleCalldata(address clOwner, address binOwner, address v3) internal pure returns (bytes memory) {
        (address[] memory t, uint256[] memory v, bytes[] memory p) = batch(clOwner, binOwner, v3);
        return abi.encodeWithSignature(
            "scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)", t, v, p, PREDECESSOR, SALT, CUSTODY_DELAY
        );
    }

    function executeCalldata(address clOwner, address binOwner, address v3) internal pure returns (bytes memory) {
        (address[] memory t, uint256[] memory v, bytes[] memory p) = batch(clOwner, binOwner, v3);
        return abi.encodeWithSignature("executeBatch(address[],uint256[],bytes[],bytes32,bytes32)", t, v, p, PREDECESSOR, SALT);
    }

    /// @dev OZ `TimelockController.hashOperationBatch`.
    function operationId(address clOwner, address binOwner, address v3) internal pure returns (bytes32) {
        (address[] memory t, uint256[] memory v, bytes[] memory p) = batch(clOwner, binOwner, v3);
        return keccak256(abi.encode(t, v, p, PREDECESSOR, SALT));
    }
}

interface IOwned {
    function owner() external view returns (address);
}

interface IV3View {
    function owner() external view returns (address);
    function policy() external view returns (address);
    function launchOracle() external view returns (address);
    function treasury() external view returns (address);
}

interface ITimelockView {
    function getMinDelay() external view returns (uint256);
    function hashOperationBatch(address[] calldata, uint256[] calldata, bytes[] calldata, bytes32, bytes32)
        external
        pure
        returns (bytes32);
    function isOperation(bytes32 id) external view returns (bool);
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/**
 * PRINTS calldata. SENDS NOTHING. There is no broadcast in this script and it reads no key.
 *
 *   FEE_CONTROLLER_V3=0x... forge script script/BuildInstallFeeControllerV3.s.sol --rpc-url $ROBINHOOD_RPC
 *
 * Refuses: the zero address, V1, V2, a V3 whose immutables do not match, and - the important one -
 * wrappers that the custody timelock does not own yet. While the Safe still owns them, installing
 * through the Safe directly would bypass the 48h tier; this script will not help do that.
 *
 * Every address comes from the environment; on Robinhood (4663) each must equal the address of record.
 */
contract BuildInstallFeeControllerV3Script is Script {
    uint256 internal constant ROBINHOOD_CHAIN_ID = 4663;
    address internal constant ROBINHOOD_SAFE = 0x715a6176946aDbD22c1B2021d321Fb3767ca3432;
    address internal constant ROBINHOOD_V1 = 0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c;
    address internal constant ROBINHOOD_V2 = 0x9c2c09EFBDb1726d3563B3f92F9912C9134f54aB;
    address internal constant ROBINHOOD_CUSTODY = 0x3aE354e2cdFB9Cb855ABA41c825F6Ee53f28e119;
    address internal constant ROBINHOOD_CL_OWNER = 0x5D7111d6c624e9a08aE63d342E4baE5878989a67;
    address internal constant ROBINHOOD_BIN_OWNER = 0x98920e33313257Ffd942f94379A7ced216462665;

    bytes32 internal constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 internal constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

    function run() external view {
        address v3 = vm.envAddress("FEE_CONTROLLER_V3");
        address safe = vm.envOr("FEE_OWNER_SAFE", ROBINHOOD_SAFE);
        address v2 = vm.envOr("FEE_POLICY_V2", ROBINHOOD_V2);
        address timelock = vm.envOr("CUSTODY_TIMELOCK", ROBINHOOD_CUSTODY);
        address clOwner = vm.envOr("CL_POOL_MANAGER_OWNER", ROBINHOOD_CL_OWNER);
        address binOwner = vm.envOr("BIN_POOL_MANAGER_OWNER", ROBINHOOD_BIN_OWNER);

        if (block.chainid == ROBINHOOD_CHAIN_ID) {
            require(
                safe == ROBINHOOD_SAFE && v2 == ROBINHOOD_V2 && timelock == ROBINHOOD_CUSTODY
                    && clOwner == ROBINHOOD_CL_OWNER && binOwner == ROBINHOOD_BIN_OWNER,
                "an address differs from the Robinhood address of record"
            );
        }

        checkOperation(v3, safe, v2, timelock, clOwner, binOwner);

        bytes32 id = InstallV3Calldata.operationId(clOwner, binOwner, v3);
        (address[] memory t, uint256[] memory v, bytes[] memory p) = InstallV3Calldata.batch(clOwner, binOwner, v3);
        require(
            ITimelockView(timelock).hashOperationBatch(t, v, p, InstallV3Calldata.PREDECESSOR, InstallV3Calldata.SALT)
                == id,
            "local operation id disagrees with the timelock"
        );
        require(!ITimelockView(timelock).isOperation(id), "this operation is already scheduled - do not schedule it again");

        console.log("=== INSTALL LatchProtocolFeeControllerV3 (custody, 48h) ===");
        console.log("  V3                  ", v3);
        console.log("  custody timelock    ", timelock);
        console.log("  CLPoolManagerOwner  ", clOwner);
        console.log("  BinPoolManagerOwner ", binOwner);
        console.log("  salt  keccak256(\"latch.install.feeControllerV3\")");
        console.logBytes32(InstallV3Calldata.SALT);
        console.log("  operation id");
        console.logBytes32(id);
        console.log("");
        console.log("1) Safe transaction: to = custody timelock, value = 0, data =");
        console.logBytes(InstallV3Calldata.scheduleCalldata(clOwner, binOwner, v3));
        console.log("");
        console.log("2) After 172800 s, ANY address: to = custody timelock, value = 0, data =");
        console.logBytes(InstallV3Calldata.executeCalldata(clOwner, binOwner, v3));
        console.log("");
        console.log("3) Verify: protocolFeeController() on BOTH managers returns V3.");
        if (!ITimelockView(timelock).hasRole(CANCELLER_ROLE, 0xe65F304e40b61d7417154cb3e725C0Ee16701142)) {
            console.log("WARNING: the dedicated canceller does not hold CANCELLER_ROLE on this timelock.");
        }
    }

    /// @notice Every refusal, as one public view so the test suite runs the exact gate.
    function checkOperation(
        address v3,
        address safe,
        address v2,
        address timelock,
        address clOwner,
        address binOwner
    ) public view {
        require(v3 != address(0), "zero address");
        require(v3 != ROBINHOOD_V1 && v3 != ROBINHOOD_V2 && v3 != v2, "that is V1 or V2, not V3");
        require(v3.code.length > 0, "no code at V3");

        IV3View c = IV3View(v3);
        require(c.owner() == safe, "V3 owner is not the Safe");
        require(c.policy() == v2, "V3.policy is not the installed V2");
        require(c.launchOracle().code.length > 0, "V3.launchOracle has no code");
        require(c.treasury() == safe, "V3 treasury is not the Safe");

        require(ITimelockView(timelock).getMinDelay() == InstallV3Calldata.CUSTODY_DELAY, "timelock is not the 48h tier");
        require(ITimelockView(timelock).hasRole(PROPOSER_ROLE, safe), "Safe is not a proposer on this timelock");
        require(
            IOwned(clOwner).owner() == timelock && IOwned(binOwner).owner() == timelock,
            "wrappers are not owned by the custody timelock yet: execute and verify the queued acceptOwnership first"
        );
    }
}
