// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {SubscriptionVault} from "../src/SubscriptionVault.sol";

contract SubscriptionVaultFuzzTest is Base {
    function _plan(uint96 price, uint32 period) internal returns (uint256 id) {
        uint32 grace = period / 3; // always < period
        id = registry.createPlan(address(usdc), price, period, grace, payee, "");
    }

    function _enrol(uint256 id, uint96 price, uint256 cycles) internal returns (address who, uint256 subId) {
        who = makeAddr("fuzzer");
        deal(address(usdc), who, uint256(price) * cycles);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        subId = vault.subscribe(id);
        vm.stopPrank();
    }

    /// Charged amount always equals plan.price, and fee splits add up.
    function testFuzz_ChargedAmountEqualsPrice(uint96 price, uint32 period, uint32 lateBy) public {
        price = uint96(bound(price, 1, 1e18));
        period = uint32(bound(period, 1, 365 days));
        lateBy = uint32(bound(lateBy, 0, period * 3));
        uint256 id = _plan(price, period);
        (address who, uint256 subId) = _enrol(id, price, 3);

        vm.warp(vault.getSubscription(subId).nextChargeAt + lateBy);
        uint256 balBefore = usdc.balanceOf(who);
        uint256 vaultBefore = usdc.balanceOf(address(vault));
        vm.prank(keeper);
        vault.charge(subId);
        assertEq(balBefore - usdc.balanceOf(who), price);
        assertEq(usdc.balanceOf(address(vault)) - vaultBefore, price);
        uint256 fee = (uint256(price) * FEE_BPS) / 10_000;
        assertEq(vault.claimable(keeper, address(usdc)), fee);
        assertEq(vault.claimable(payee, address(usdc)), 2 * uint256(price) - fee);
    }

    /// Charge before nextChargeAt always reverts.
    function testFuzz_ChargeBeforeDueReverts(uint96 price, uint32 period, uint32 earlyBy, address caller) public {
        price = uint96(bound(price, 1, 1e18));
        period = uint32(bound(period, 1, 365 days));
        earlyBy = uint32(bound(earlyBy, 1, period));
        uint256 id = _plan(price, period);
        (, uint256 subId) = _enrol(id, price, 3);

        vm.warp(vault.getSubscription(subId).nextChargeAt - earlyBy);
        vm.expectRevert(SubscriptionVault.NotDue.selector);
        vm.prank(caller);
        vault.charge(subId);
    }

    /// nextChargeAt after k successful charges = startedAt + (k+1)·period, regardless of keeper delays.
    function testFuzz_AnchoredSchedule(uint32 period, uint8 k, uint256 delaySeed) public {
        period = uint32(bound(period, 60, 30 days));
        k = uint8(bound(k, 0, 24));
        uint256 id = _plan(20e6, period);
        (, uint256 subId) = _enrol(id, 20e6, uint256(k) + 1);
        uint64 startedAt = vault.getSubscription(subId).startedAt;

        for (uint256 i; i < k; ++i) {
            uint64 due = vault.getSubscription(subId).nextChargeAt;
            uint256 delay = uint256(keccak256(abi.encode(delaySeed, i))) % (period / 3 + 1); // within grace
            if (block.timestamp < due + delay) vm.warp(due + delay);
            vault.charge(subId);
        }
        SubscriptionVault.Subscription memory s = vault.getSubscription(subId);
        assertEq(s.nextChargeAt, startedAt + (uint256(k) + 1) * period);
        assertEq(s.chargeCount, uint256(k) + 1);
    }
}
