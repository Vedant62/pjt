// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Base} from "./Base.t.sol";
import {PlanRegistry} from "../src/PlanRegistry.sol";
import {SubscriptionVault} from "../src/SubscriptionVault.sol";

contract SubscriptionVaultTest is Base {
    event Subscribed(
        uint256 indexed subId, uint256 indexed planId, address indexed subscriber, uint256 amount, uint64 nextChargeAt
    );
    event Charged(
        uint256 indexed subId,
        uint256 indexed planId,
        uint256 amount,
        uint256 fee,
        address indexed keeper,
        uint64 newNextChargeAt
    );
    event ChargeFailed(uint256 indexed subId, uint8 reason);
    event SubscriptionLapsed(uint256 indexed subId);
    event Cancelled(uint256 indexed subId, uint64 paidThrough);
    event Withdrawn(address indexed account, address indexed token, uint256 amount);

    // ------------------------------------------------------------------ constructor

    function test_Constructor() public view {
        assertEq(address(vault.registry()), address(registry));
        assertEq(vault.keeperFeeBps(), FEE_BPS);
    }

    function test_RevertWhen_FeeTooHigh() public {
        vm.expectRevert(SubscriptionVault.FeeTooHigh.selector);
        new SubscriptionVault(registry, 1_001);
    }

    // ------------------------------------------------------------------ subscribe

    function test_Subscribe() public {
        uint64 t0 = uint64(block.timestamp);
        vm.startPrank(alice);
        usdc.approve(address(vault), PRICE * 12);
        vm.expectEmit(address(vault));
        emit Subscribed(1, planId, alice, PRICE, t0 + PERIOD);
        uint256 subId = vault.subscribe(planId);
        vm.stopPrank();

        assertEq(subId, 1);
        assertEq(vault.subscriptionCount(), 1);
        SubscriptionVault.Subscription memory s = vault.getSubscription(subId);
        assertEq(s.subscriber, alice);
        assertEq(s.planId, planId);
        assertEq(s.startedAt, t0);
        assertEq(s.nextChargeAt, t0 + PERIOD);
        assertEq(s.pastDueSince, 0);
        assertEq(s.chargeCount, 1);
        assertEq(uint8(s.status), uint8(SubscriptionVault.Status.Active));

        assertEq(usdc.balanceOf(alice), 1_000e6 - PRICE);
        assertEq(usdc.balanceOf(address(vault)), PRICE);
        assertEq(vault.claimable(payee, address(usdc)), PRICE);
        assertEq(usdc.allowance(alice, address(vault)), PRICE * 11);
        assertTrue(vault.isEntitled(subId));
        assertEq(vault.entitledSubOf(alice, planId), subId);
        assertEq(vault.latestSubOf(alice, planId), subId);
    }

    function test_SubscribeWithPermit() public {
        uint256 value = uint256(PRICE) * 12;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(aliceKey, alice, address(vault), value, deadline);

        vm.prank(alice);
        uint256 subId = vault.subscribeWithPermit(planId, value, deadline, v, r, s);

        assertEq(usdc.allowance(alice, address(vault)), value - PRICE);
        assertEq(usdc.balanceOf(address(vault)), PRICE);
        assertEq(usdc.nonces(alice), 1);
        assertTrue(vault.isEntitled(subId));
    }

    function test_SubscribeWithPermit_FrontRunFallback() public {
        uint256 value = uint256(PRICE) * 12;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(aliceKey, alice, address(vault), value, deadline);

        // An observer copies the signature out of the mempool and submits the permit first.
        vm.prank(attacker);
        usdc.permit(alice, address(vault), value, deadline, v, r, s);

        // Alice's own permit call now fails inside the vault, but enrolment still succeeds.
        vm.prank(alice);
        uint256 subId = vault.subscribeWithPermit(planId, value, deadline, v, r, s);
        assertEq(uint8(vault.getSubscription(subId).status), uint8(SubscriptionVault.Status.Active));
        assertEq(usdc.allowance(alice, address(vault)), value - PRICE);
    }

    function test_RevertWhen_PermitInvalidAndNoAllowance() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(0xBAD, alice, address(vault), PRICE, deadline);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vault), 0, PRICE)
        );
        vm.prank(alice);
        vault.subscribeWithPermit(planId, PRICE, deadline, v, r, s);
    }

    function test_RevertWhen_DuplicateSubscription() public {
        uint256 subId = _subscribeAlice();
        vm.expectRevert(abi.encodeWithSelector(SubscriptionVault.AlreadySubscribed.selector, subId));
        vm.prank(alice);
        vault.subscribe(planId);
    }

    function test_RevertWhen_DuplicateWhilePastDue() public {
        uint256 subId = _subscribeAlice();
        _drain(alice);
        vm.warp(block.timestamp + PERIOD);
        vault.charge(subId);
        assertEq(uint8(vault.getSubscription(subId).status), uint8(SubscriptionVault.Status.PastDue));
        usdc.mint(alice, 100e6);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionVault.AlreadySubscribed.selector, subId));
        vm.prank(alice);
        vault.subscribe(planId);
    }

    function test_ResubscribeAfterCancel() public {
        uint256 first = _subscribeAlice();
        vm.prank(alice);
        vault.cancel(first);
        vm.prank(alice);
        uint256 second = vault.subscribe(planId);
        assertEq(second, 2);
        assertEq(vault.latestSubOf(alice, planId), second);
        assertEq(vault.entitledSubOf(alice, planId), second);
    }

    function test_ResubscribeAfterLapse() public {
        uint256 first = _subscribeAlice();
        _drain(alice);
        vm.warp(block.timestamp + PERIOD + GRACE);
        vault.charge(first);
        assertEq(uint8(vault.getSubscription(first).status), uint8(SubscriptionVault.Status.Lapsed));
        usdc.mint(alice, 100e6);
        vm.prank(alice);
        uint256 second = vault.subscribe(planId);
        assertEq(second, 2);
    }

    function test_RevertWhen_PlanInactive() public {
        vm.prank(provider);
        registry.setPlanActive(planId, false);
        vm.startPrank(alice);
        usdc.approve(address(vault), PRICE);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionVault.PlanInactive.selector, planId));
        vault.subscribe(planId);
        vm.stopPrank();
    }

    function test_InactivePlanDoesNotAffectExistingSubs() public {
        uint256 subId = _subscribeAlice();
        vm.prank(provider);
        registry.setPlanActive(planId, false);
        vm.warp(block.timestamp + PERIOD);
        vm.prank(keeper);
        vault.charge(subId);
        assertEq(vault.getSubscription(subId).chargeCount, 2);
    }

    function test_RevertWhen_UnknownPlan() public {
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.UnknownPlan.selector, 99));
        vm.prank(alice);
        vault.subscribe(99);
    }

    function test_RevertWhen_SubscribeWithoutBalance() public {
        address poor = makeAddr("poor");
        vm.startPrank(poor);
        usdc.approve(address(vault), PRICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poor, 0, PRICE));
        vault.subscribe(planId);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ charge

    function test_Charge() public {
        uint256 subId = _subscribeAlice();
        uint64 next = vault.getSubscription(subId).nextChargeAt;
        vm.warp(next);

        uint256 fee = _fee(PRICE);
        vm.expectEmit(address(vault));
        emit Charged(subId, planId, PRICE, fee, keeper, next + PERIOD);
        vm.prank(keeper);
        vault.charge(subId);

        SubscriptionVault.Subscription memory s = vault.getSubscription(subId);
        assertEq(s.nextChargeAt, next + PERIOD);
        assertEq(s.chargeCount, 2);
        assertEq(uint8(s.status), uint8(SubscriptionVault.Status.Active));
        assertEq(usdc.balanceOf(alice), 1_000e6 - 2 * PRICE);
        assertEq(vault.claimable(payee, address(usdc)), 2 * PRICE - fee);
        assertEq(vault.claimable(keeper, address(usdc)), fee);
        assertEq(fee, 50_000); // 0.25% of 20 mUSDC = 0.05 mUSDC
    }

    function test_ChargeWithZeroFee() public {
        SubscriptionVault v0 = new SubscriptionVault(registry, 0);
        vm.startPrank(alice);
        usdc.approve(address(v0), PRICE * 2);
        uint256 subId = v0.subscribe(planId);
        vm.stopPrank();
        vm.warp(block.timestamp + PERIOD);
        vm.prank(keeper);
        v0.charge(subId);
        assertEq(v0.claimable(payee, address(usdc)), 2 * PRICE);
        assertEq(v0.claimable(keeper, address(usdc)), 0);
    }

    function test_RevertWhen_ChargeUnknownSub() public {
        vm.expectRevert(
            abi.encodeWithSelector(SubscriptionVault.NotChargeable.selector, SubscriptionVault.Status.None)
        );
        vault.charge(42);
    }

    function test_ChargeFailed_Balance() public {
        uint256 subId = _subscribeAlice();
        _drain(alice);
        uint64 due = vault.getSubscription(subId).nextChargeAt;
        vm.warp(due + 1);

        vm.expectEmit(address(vault));
        emit ChargeFailed(subId, 1);
        vm.prank(keeper);
        vault.charge(subId);

        SubscriptionVault.Subscription memory s = vault.getSubscription(subId);
        assertEq(uint8(s.status), uint8(SubscriptionVault.Status.PastDue));
        assertEq(s.pastDueSince, due);
        assertEq(s.nextChargeAt, due);
        assertEq(s.chargeCount, 1);
        assertEq(vault.claimable(keeper, address(usdc)), 0); // no fee on failure
        assertTrue(vault.isEntitled(subId)); // still in grace

        // A second failure keeps the original pastDueSince.
        vm.warp(due + 10);
        vault.charge(subId);
        assertEq(vault.getSubscription(subId).pastDueSince, due);
    }

    function test_ChargeFailed_Allowance() public {
        uint256 subId = _subscribeAlice();
        vm.prank(alice);
        usdc.approve(address(vault), PRICE - 1);
        vm.warp(block.timestamp + PERIOD);

        vm.expectEmit(address(vault));
        emit ChargeFailed(subId, 2);
        vault.charge(subId);
        assertEq(uint8(vault.getSubscription(subId).status), uint8(SubscriptionVault.Status.PastDue));
    }

    function test_RecoverFromPastDue() public {
        uint256 subId = _subscribeAlice();
        _drain(alice);
        uint64 due = vault.getSubscription(subId).nextChargeAt;
        vm.warp(due);
        vault.charge(subId);

        usdc.mint(alice, 100e6); // top up within grace
        vm.warp(due + GRACE - 1);
        vm.prank(keeper);
        vault.charge(subId);

        SubscriptionVault.Subscription memory s = vault.getSubscription(subId);
        assertEq(uint8(s.status), uint8(SubscriptionVault.Status.Active));
        assertEq(s.pastDueSince, 0);
        assertEq(s.nextChargeAt, due + PERIOD); // anchored: not reset to "now + period"
        assertEq(s.chargeCount, 2);
    }

    function test_LapseAfterGrace() public {
        uint256 subId = _subscribeAlice();
        _drain(alice);
        uint64 due = vault.getSubscription(subId).nextChargeAt;
        vm.warp(due + GRACE);

        vm.expectEmit(address(vault));
        emit SubscriptionLapsed(subId);
        vm.prank(keeper);
        vault.charge(subId);

        assertEq(uint8(vault.getSubscription(subId).status), uint8(SubscriptionVault.Status.Lapsed));
        assertFalse(vault.isEntitled(subId));
        assertEq(vault.claimable(keeper, address(usdc)), 0);

        vm.expectRevert(
            abi.encodeWithSelector(SubscriptionVault.NotChargeable.selector, SubscriptionVault.Status.Lapsed)
        );
        vault.charge(subId);
    }

    function test_PastDueThenLapse() public {
        uint256 subId = _subscribeAlice();
        _drain(alice);
        uint64 due = vault.getSubscription(subId).nextChargeAt;
        vm.warp(due);
        vault.charge(subId);
        vm.warp(due + GRACE);
        assertFalse(vault.isEntitled(subId)); // grace over: access cut even before the keeper acts
        vault.charge(subId);
        SubscriptionVault.Subscription memory s = vault.getSubscription(subId);
        assertEq(uint8(s.status), uint8(SubscriptionVault.Status.Lapsed));
        assertEq(s.pastDueSince, 0);
    }

    function test_LateChargeWithFundsSucceeds() public {
        uint256 subId = _subscribeAlice();
        uint64 due = vault.getSubscription(subId).nextChargeAt;
        vm.warp(due + GRACE + 1000); // keeper very late, funds fine
        vault.charge(subId);
        assertEq(vault.getSubscription(subId).nextChargeAt, due + PERIOD);
    }

    function test_CatchUpAfterOutage() public {
        uint256 subId = _subscribeAlice();
        uint64 start = vault.getSubscription(subId).startedAt;
        vm.warp(start + 3 * PERIOD + 5);
        vault.charge(subId);
        vault.charge(subId);
        vault.charge(subId);
        SubscriptionVault.Subscription memory s = vault.getSubscription(subId);
        assertEq(s.chargeCount, 4);
        assertEq(s.nextChargeAt, start + 4 * PERIOD);
        vm.expectRevert(SubscriptionVault.NotDue.selector);
        vault.charge(subId);
    }

    // ------------------------------------------------------------------ batch

    function test_ChargeBatch() public {
        uint256 a = _subscribeAlice();
        (address bob, uint256 b) = _subscribeNew("bob");
        (address carol, uint256 c) = _subscribeNew("carol");
        (, uint256 d) = _subscribeNew("dave");
        _drain(bob);
        vm.prank(carol);
        vault.cancel(c);

        vm.warp(block.timestamp + PERIOD);
        // Make d "not due" by charging it first.
        vault.charge(d);

        uint256[] memory ids = new uint256[](6);
        ids[0] = a; // ok
        ids[1] = b; // failed (PastDue)
        ids[2] = c; // skipped (cancelled)
        ids[3] = d; // skipped (not due)
        ids[4] = 999; // skipped (unknown)
        ids[5] = a; // skipped (now not due)
        vm.prank(keeper);
        (uint256 ok, uint256 failed, uint256 skipped) = vault.chargeBatch(ids);
        assertEq(ok, 1);
        assertEq(failed, 1);
        assertEq(skipped, 4);
        assertEq(vault.claimable(keeper, address(usdc)), _fee(PRICE));
    }

    function test_ChargeBatch_LapseCountsAsFailed() public {
        uint256 a = _subscribeAlice();
        _drain(alice);
        vm.warp(block.timestamp + PERIOD + GRACE);
        uint256[] memory ids = new uint256[](1);
        ids[0] = a;
        (uint256 ok, uint256 failed, uint256 skipped) = vault.chargeBatch(ids);
        assertEq(ok, 0);
        assertEq(failed, 1);
        assertEq(skipped, 0);
        assertEq(uint8(vault.getSubscription(a).status), uint8(SubscriptionVault.Status.Lapsed));
    }

    function test_ChargeBatch_Empty() public {
        (uint256 ok, uint256 failed, uint256 skipped) = vault.chargeBatch(new uint256[](0));
        assertEq(ok + failed + skipped, 0);
    }

    function test_RevertWhen_BatchTooLarge() public {
        vm.expectRevert(abi.encodeWithSelector(SubscriptionVault.BatchTooLarge.selector, 201));
        vault.chargeBatch(new uint256[](201));
    }

    // ------------------------------------------------------------------ cancel

    function test_Cancel() public {
        uint256 subId = _subscribeAlice();
        uint64 paidThrough = vault.getSubscription(subId).nextChargeAt;

        vm.expectEmit(address(vault));
        emit Cancelled(subId, paidThrough);
        vm.prank(alice);
        vault.cancel(subId);

        assertEq(uint8(vault.getSubscription(subId).status), uint8(SubscriptionVault.Status.Cancelled));
        vm.warp(paidThrough - 1);
        assertTrue(vault.isEntitled(subId)); // paid-through
        assertEq(vault.entitledSubOf(alice, planId), subId);
        vm.warp(paidThrough);
        assertFalse(vault.isEntitled(subId)); // no grace for cancelled subs
        assertEq(vault.entitledSubOf(alice, planId), 0);
    }

    function test_CancelPastDueNotEntitled() public {
        uint256 subId = _subscribeAlice();
        _drain(alice);
        vm.warp(block.timestamp + PERIOD);
        vault.charge(subId);
        vm.prank(alice);
        vault.cancel(subId);
        assertFalse(vault.isEntitled(subId)); // unpaid period is not "paid through"
        assertEq(vault.getSubscription(subId).pastDueSince, 0);
    }

    function test_RevertWhen_CancelByNonSubscriber() public {
        uint256 subId = _subscribeAlice();
        vm.expectRevert(SubscriptionVault.NotSubscriber.selector);
        vm.prank(attacker);
        vault.cancel(subId);
    }

    function test_RevertWhen_CancelTwice() public {
        uint256 subId = _subscribeAlice();
        vm.startPrank(alice);
        vault.cancel(subId);
        vm.expectRevert(
            abi.encodeWithSelector(SubscriptionVault.NotChargeable.selector, SubscriptionVault.Status.Cancelled)
        );
        vault.cancel(subId);
        vm.stopPrank();
    }

    function test_RevertWhen_CancelUnknown() public {
        vm.expectRevert(SubscriptionVault.NotSubscriber.selector);
        vm.prank(alice);
        vault.cancel(77);
    }

    // ------------------------------------------------------------------ withdraw

    function test_Withdraw() public {
        uint256 subId = _subscribeAlice();
        vm.warp(block.timestamp + PERIOD);
        vm.prank(keeper);
        vault.charge(subId);

        uint256 payeeAmt = 2 * PRICE - _fee(PRICE);
        vm.expectEmit(address(vault));
        emit Withdrawn(payee, address(usdc), payeeAmt);
        vm.prank(payee);
        vault.withdraw(address(usdc));
        assertEq(usdc.balanceOf(payee), payeeAmt);
        assertEq(vault.claimable(payee, address(usdc)), 0);

        vm.prank(keeper);
        vault.withdraw(address(usdc));
        assertEq(usdc.balanceOf(keeper), _fee(PRICE));
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_RevertWhen_WithdrawZero() public {
        vm.expectRevert(SubscriptionVault.NothingToWithdraw.selector);
        vm.prank(payee);
        vault.withdraw(address(usdc));
    }

    // ------------------------------------------------------------------ views

    function test_IsEntitled_Transitions() public {
        assertFalse(vault.isEntitled(1)); // None
        uint256 subId = _subscribeAlice();
        uint64 due = vault.getSubscription(subId).nextChargeAt;
        vm.warp(due + GRACE - 1);
        assertTrue(vault.isEntitled(subId)); // Active, keeper late but within grace
        vm.warp(due + GRACE);
        assertFalse(vault.isEntitled(subId)); // Active but grace over
        assertEq(vault.entitledSubOf(alice, planId), 0);
    }

    function test_EntitledSubOf_None() public view {
        assertEq(vault.entitledSubOf(alice, planId), 0);
        assertEq(vault.latestSubOf(alice, planId), 0);
    }

    function test_DueSubscriptions() public {
        uint256 a = _subscribeAlice();
        (, uint256 b) = _subscribeNew("bob");
        (address carol, uint256 c) = _subscribeNew("carol");
        (, uint256 d) = _subscribeNew("dave");
        vm.prank(carol);
        vault.cancel(c);

        (uint256[] memory none, uint256 cur0) = vault.dueSubscriptions(0, 10);
        assertEq(none.length, 0);
        assertEq(cur0, 0);

        vm.warp(block.timestamp + PERIOD);
        vault.charge(d); // d no longer due

        (uint256[] memory ids, uint256 next) = vault.dueSubscriptions(0, 2);
        assertEq(ids.length, 2);
        assertEq(ids[0], a);
        assertEq(ids[1], b);
        assertEq(next, 3);

        (ids, next) = vault.dueSubscriptions(next, 2);
        assertEq(ids.length, 0); // c cancelled, d charged
        assertEq(next, 0);

        (ids, next) = vault.dueSubscriptions(1, 100);
        assertEq(ids.length, 2);
        assertEq(next, 0);

        (ids, next) = vault.dueSubscriptions(5, 10); // past the end
        assertEq(ids.length, 0);
        assertEq(next, 0);

        (ids, next) = vault.dueSubscriptions(1, 0); // zero limit
        assertEq(ids.length, 0);
        assertEq(next, 0);
    }

    function test_DueSubscriptions_IncludesPastDue() public {
        uint256 a = _subscribeAlice();
        _drain(alice);
        vm.warp(block.timestamp + PERIOD);
        vault.charge(a);
        (uint256[] memory ids,) = vault.dueSubscriptions(0, 10);
        assertEq(ids.length, 1);
        assertEq(ids[0], a);
    }

    // ------------------------------------------------------------------ the five "keeper cannot" properties

    function test_KeeperCannot_ChargeEarly() public {
        uint256 subId = _subscribeAlice();
        vm.warp(vault.getSubscription(subId).nextChargeAt - 1);
        vm.expectRevert(SubscriptionVault.NotDue.selector);
        vm.prank(attacker);
        vault.charge(subId);
    }

    function test_KeeperCannot_ChargeTwiceInPeriod() public {
        uint256 subId = _subscribeAlice();
        vm.warp(vault.getSubscription(subId).nextChargeAt);
        vm.prank(attacker);
        vault.charge(subId);
        vm.expectRevert(SubscriptionVault.NotDue.selector);
        vm.prank(attacker);
        vault.charge(subId);
        assertEq(usdc.balanceOf(alice), 1_000e6 - 2 * PRICE);
    }

    function test_KeeperCannot_ChargeCancelled() public {
        uint256 subId = _subscribeAlice();
        vm.prank(alice);
        vault.cancel(subId);
        vm.warp(block.timestamp + 10 * PERIOD);
        vm.expectRevert(
            abi.encodeWithSelector(SubscriptionVault.NotChargeable.selector, SubscriptionVault.Status.Cancelled)
        );
        vm.prank(attacker);
        vault.charge(subId);
    }

    function test_KeeperCannot_PullMoreThanPrice() public {
        _subscribeAlice(); // alice granted the VAULT an allowance, not the attacker
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, attacker, 0, 1_000e6)
        );
        vm.prank(attacker);
        usdc.transferFrom(alice, attacker, 1_000e6);

        // And the vault exposes no amount parameter: one charge moves exactly `price`.
        vm.warp(block.timestamp + PERIOD);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(attacker);
        vault.charge(1);
        assertEq(before - usdc.balanceOf(alice), PRICE);
    }

    function test_KeeperCannot_RedirectPayeeFunds() public {
        _subscribeAlice();
        vm.expectRevert(SubscriptionVault.NothingToWithdraw.selector);
        vm.prank(attacker);
        vault.withdraw(address(usdc));
        assertEq(vault.claimable(payee, address(usdc)), PRICE);

        // There is no setter for the payee in either contract.
        (bool ok,) = address(registry).call(abi.encodeWithSignature("setPayee(uint256,address)", planId, attacker));
        assertFalse(ok);
        (ok,) = address(vault).call(abi.encodeWithSignature("setPayee(uint256,address)", planId, attacker));
        assertFalse(ok);
        assertEq(registry.getPlan(planId).payee, payee);
    }

    // ------------------------------------------------------------------ helpers

    function _drain(address who) internal {
        uint256 bal = usdc.balanceOf(who);
        vm.prank(who);
        usdc.transfer(address(0xdead), bal);
    }

    function _subscribeNew(string memory name) internal returns (address who, uint256 subId) {
        who = makeAddr(name);
        usdc.mint(who, 1_000e6);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        subId = vault.subscribe(planId);
        vm.stopPrank();
    }
}
