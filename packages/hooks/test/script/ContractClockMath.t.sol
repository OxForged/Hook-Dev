// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {ContractClockMath} from "../../script/ContractClock.sol";

/// @dev External wrapper, so `vm.expectRevert` sees a call boundary.
contract ContractClockMathHarness {
    function centisPerBlock(uint256 n0, uint256 t0, uint256 n1, uint256 t1) external pure returns (uint256) {
        return ContractClockMath.centisPerBlock(n0, t0, n1, t1);
    }

    function requireDeclaredMatches(uint256 declared, uint256 measured) external pure {
        ContractClockMath.requireDeclaredMatches(declared, measured);
    }

    function quantity(bytes memory raw) external pure returns (uint256) {
        return ContractClockMath.quantity(raw);
    }
}

/// @title ContractClockMathTest
/// @notice The deploy-time guard that would have refused `blockTimeCentis = 10` on Robinhood.
/// @dev Fixtures are real 4663 headers read on 2026-09-13: L2 62,356,430 (l1BlockNumber 25,971,883,
/// timestamp 1,789,343,079) and L2 62,390,206 (l1BlockNumber 25,972,166, timestamp 1,789,346,507).
/// 3,428 s over 283 contract blocks is 12.11 s per block.
contract ContractClockMathTest is Test {
    ContractClockMathHarness h;

    uint256 constant RH_N0 = 25_971_883;
    uint256 constant RH_T0 = 1_789_343_079;
    uint256 constant RH_N1 = 25_972_166;
    uint256 constant RH_T1 = 1_789_346_507;

    function setUp() public {
        h = new ContractClockMathHarness();
    }

    /* ------------------------------------------------------------ measurement */

    function test_robinhoodMeasuresTwelveSeconds() public view {
        assertEq(h.centisPerBlock(RH_N0, RH_T0, RH_N1, RH_T1), 1211);
    }

    function test_nativeTwelveSecondChain() public view {
        // Ten Ethereum slots, no missed ones.
        assertEq(h.centisPerBlock(100, 1_000, 110, 1_120), 1200);
    }

    function test_refusesAClockThatDidNotAdvance() public {
        vm.expectRevert(abi.encodeWithSelector(ContractClockMath.ClockDidNotAdvance.selector, 100, 100));
        h.centisPerBlock(100, 1_000, 100, 2_000);
    }

    function test_refusesAWindowTooShortInTime() public {
        vm.expectRevert(abi.encodeWithSelector(ContractClockMath.ClockWindowTooShort.selector, 119, 120));
        h.centisPerBlock(100, 1_000, 200, 1_119);
    }

    function test_refusesATimestampThatWentBackwards() public {
        vm.expectRevert(abi.encodeWithSelector(ContractClockMath.ClockWindowTooShort.selector, 0, 120));
        h.centisPerBlock(100, 2_000, 200, 1_000);
    }

    function test_refusesTooFewBlocks() public {
        vm.expectRevert(abi.encodeWithSelector(ContractClockMath.ClockWindowTooFewBlocks.selector, 7, 8));
        h.centisPerBlock(100, 1_000, 107, 2_000);
    }

    /* ------------------------------------------------------------- the check */

    /// @dev THE BUG. The live kit, launch hook and revenue-share hook declared 10.
    function test_refusesTheLiveRobinhoodDeclaration() public {
        uint256 measured = h.centisPerBlock(RH_N0, RH_T0, RH_N1, RH_T1);
        vm.expectRevert(abi.encodeWithSelector(ContractClockMath.DeclaredBlockTimeTooShort.selector, 10, measured));
        h.requireDeclaredMatches(10, measured);
    }

    function test_acceptsTwelveSecondsOnRobinhood() public view {
        h.requireDeclaredMatches(1200, h.centisPerBlock(RH_N0, RH_T0, RH_N1, RH_T1));
    }

    /// @dev Too long is the dangerous direction: every window comes out short.
    function test_refusesADeclarationThatWouldShortenWindows() public {
        vm.expectRevert(abi.encodeWithSelector(ContractClockMath.DeclaredBlockTimeTooLong.selector, 1300, 1200));
        h.requireDeclaredMatches(1300, 1200);
    }

    function test_boundaries() public {
        // 105% of 1200 is 1260: allowed; 1261 is not.
        h.requireDeclaredMatches(1260, 1200);
        vm.expectRevert(abi.encodeWithSelector(ContractClockMath.DeclaredBlockTimeTooLong.selector, 1261, 1200));
        h.requireDeclaredMatches(1261, 1200);

        // 75% of 1200 is 900: allowed; 899 is not.
        h.requireDeclaredMatches(900, 1200);
        vm.expectRevert(abi.encodeWithSelector(ContractClockMath.DeclaredBlockTimeTooShort.selector, 899, 1200));
        h.requireDeclaredMatches(899, 1200);
    }

    function test_refusesZeroDeclared() public {
        vm.expectRevert(abi.encodeWithSelector(ContractClockMath.DeclaredBlockTimeTooShort.selector, 0, 1200));
        h.requireDeclaredMatches(0, 1200);
    }

    /// @dev Any declaration inside the band passes; anything more than 5% over always fails.
    function testFuzz_bandIsExactlyWhatItSays(uint256 declared, uint256 measured) public {
        measured = bound(measured, 1, 60_000);
        declared = bound(declared, 0, 120_000);
        bool ok = declared * 100 <= measured * 105 && declared * 100 >= measured * 75;
        if (!ok) vm.expectRevert();
        h.requireDeclaredMatches(declared, measured);
    }

    /* ------------------------------------------------------------ decoding */

    function test_quantityDecodesVariableWidthBigEndian() public view {
        assertEq(h.quantity(hex"03b94195"), 62_472_597);
        assertEq(h.quantity(hex""), 0);
        assertEq(h.quantity(hex"01"), 1);
    }
}
