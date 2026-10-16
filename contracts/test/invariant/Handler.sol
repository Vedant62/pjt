// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {PlanRegistry} from "../../src/PlanRegistry.sol";
import {SubscriptionVault} from "../../src/SubscriptionVault.sol";

/// @notice Drives random sequences of protocol actions and keeps independent ghost accounting
///         derived from token balance movements (not from the vault's own bookkeeping).
contract Handler is Test {
    MockUSDC public usdc;
    PlanRegistry public registry;
    SubscriptionVault public vault;

    address[] public subscribers;
    address[] public keepers;
    address[] public payees;
    address public attacker = makeAddr("inv-attacker");
    uint256[] public planIds;

    uint256 public time;

    // ghost state
    mapping(address => uint256) public ghostPulled; // token moved from subscriber into the vault
    mapping(address => uint256) public ghostCredited; // amount each account became entitled to
    mapping(address => uint256) public ghostWithdrawn; // token moved from the vault to the account
    mapping(uint256 => bool) public ghostTerminal; // sub observed Cancelled or Lapsed
    mapping(uint256 => uint32) public ghostTerminalCount; // chargeCount when first observed terminal
    bool public ghostChargedAfterTerminal;
    bool public ghostAttackerWithdrew;

    mapping(bytes32 => uint256) public calls;

    constructor(MockUSDC usdc_, PlanRegistry registry_, SubscriptionVault vault_) {
        usdc = usdc_;
        registry = registry_;
        vault = vault_;
        time = block.timestamp;

        for (uint256 i; i < 5; ++i) subscribers.push(makeAddr(string.concat("sub", vm.toString(i))));
        for (uint256 i; i < 3; ++i) keepers.push(makeAddr(string.concat("keeper", vm.toString(i))));
        payees.push(makeAddr("payeeA"));
        payees.push(makeAddr("payeeB"));

        planIds.push(registry.createPlan(address(usdc), 20e6, 180, 60, payees[0], "demo"));
        planIds.push(registry.createPlan(address(usdc), 7_777_777, 1 days, 1 hours, payees[1], "daily"));
        planIds.push(registry.createPlan(address(usdc), 3e6, 600, 599, payees[0], "edge-grace"));

        for (uint256 i; i < subscribers.length; ++i) {
            deal(address(usdc), subscribers[i], 500e6);
            vm.prank(subscribers[i]);
            usdc.approve(address(vault), type(uint256).max);
        }
    }

    modifier tick(bytes32 name) {
        vm.warp(time);
        calls[name]++;
        _;
    }

    // ------------------------------------------------------------------ actions

    function subscribe(uint256 who, uint256 plan) external tick("subscribe") {
        address s = subscribers[who % subscribers.length];
        uint256 id = planIds[plan % planIds.length];
        (address payee,, uint96 price,,,) = registry.getPlanTerms(id);
        uint256 before = usdc.balanceOf(s);
        vm.prank(s);
        try vault.subscribe(id) {
            ghostPulled[s] += before - usdc.balanceOf(s);
            ghostCredited[payee] += price;
        } catch {}
    }

    function charge(uint256 subSeed, uint256 keeperSeed) external tick("charge") {
        uint256 n = vault.subscriptionCount();
        if (n == 0) return;
        uint256 subId = subSeed % n + 1;
        address k = keepers[keeperSeed % keepers.length];
        _observe(subId, k);
    }

    function chargeBatch(uint256 seed, uint8 size) external tick("chargeBatch") {
        uint256 n = vault.subscriptionCount();
        if (n == 0) return;
        size = uint8(bound(size, 1, 12));
        uint256[] memory ids = new uint256[](size);
        for (uint256 i; i < size; ++i) ids[i] = uint256(keccak256(abi.encode(seed, i))) % (n + 2) + 1; // incl. unknown ids
        address k = keepers[seed % keepers.length];

        SubscriptionVault.Subscription[] memory pre = new SubscriptionVault.Subscription[](size);
        for (uint256 i; i < size; ++i) pre[i] = vault.getSubscription(ids[i]);
        vm.prank(k);
        vault.chargeBatch(ids);
        _accountBatch(ids, pre, k);
    }

    /// Realistic keeper: sweep every due subscription in one batch.
    function keeperSweep(uint256 keeperSeed) external tick("keeperSweep") {
        (uint256[] memory ids,) = vault.dueSubscriptions(0, 200);
        if (ids.length == 0) return;
        address k = keepers[keeperSeed % keepers.length];
        SubscriptionVault.Subscription[] memory pre = new SubscriptionVault.Subscription[](ids.length);
        for (uint256 i; i < ids.length; ++i) pre[i] = vault.getSubscription(ids[i]);
        vm.prank(k);
        vault.chargeBatch(ids);
        _accountBatch(ids, pre, k);
    }

    function cancel(uint256 subSeed) external tick("cancel") {
        uint256 n = vault.subscriptionCount();
        if (n == 0) return;
        if (subSeed % 4 != 0) return; // cancel is rarer than other actions
        uint256 subId = (subSeed / 4) % n + 1;
        address s = vault.getSubscription(subId).subscriber;
        vm.prank(s);
        try vault.cancel(subId) {} catch {}
        _markTerminal(subId);
    }

    function warp(uint32 secs) external tick("warp") {
        time += bound(secs, 1, 6 hours);
    }

    function drain(uint256 who) external tick("drain") {
        if (who % 3 != 0) return; // drain is rarer than other actions
        who /= 3;
        address s = subscribers[who % subscribers.length];
        uint256 bal = usdc.balanceOf(s);
        vm.prank(s);
        usdc.transfer(address(0xdead), bal);
    }

    function topUp(uint256 who, uint256 amount) external tick("topUp") {
        address s = subscribers[who % subscribers.length];
        deal(address(usdc), s, usdc.balanceOf(s) + bound(amount, 1e6, 200e6));
    }

    function setAllowance(uint256 who, uint256 amount) external tick("setAllowance") {
        address s = subscribers[who % subscribers.length];
        vm.prank(s);
        usdc.approve(address(vault), bound(amount, 0, 100e6));
    }

    function withdraw(uint256 accountSeed) external tick("withdraw") {
        address[] memory accts = allAccounts();
        address a = accts[accountSeed % accts.length];
        uint256 before = usdc.balanceOf(a);
        vm.prank(a);
        try vault.withdraw(address(usdc)) {
            ghostWithdrawn[a] += usdc.balanceOf(a) - before;
        } catch {}
    }

    function attackerWithdraw() external tick("attackerWithdraw") {
        vm.prank(attacker);
        try vault.withdraw(address(usdc)) {
            ghostAttackerWithdrew = true;
        } catch {}
    }

    // ------------------------------------------------------------------ internal accounting

    function _observe(uint256 subId, address k) internal {
        SubscriptionVault.Subscription memory pre = vault.getSubscription(subId);
        uint256 balBefore = pre.subscriber == address(0) ? 0 : usdc.balanceOf(pre.subscriber);
        vm.prank(k);
        try vault.charge(subId) {} catch {}
        _accountOne(subId, pre, balBefore, k);
    }

    function _accountBatch(uint256[] memory ids, SubscriptionVault.Subscription[] memory pre, address k) internal {
        // Batches may repeat an id; account each distinct sub once using its total chargeCount delta.
        for (uint256 i; i < ids.length; ++i) {
            bool seen;
            for (uint256 j; j < i; ++j) if (ids[j] == ids[i]) seen = true;
            if (seen) continue;
            SubscriptionVault.Subscription memory post = vault.getSubscription(ids[i]);
            uint256 newCharges = post.chargeCount - pre[i].chargeCount;
            if (newCharges > 0) {
                if (ghostTerminal[ids[i]]) ghostChargedAfterTerminal = true;
                (address payee,, uint96 price,,,) = registry.getPlanTerms(post.planId);
                uint256 fee = (uint256(price) * vault.keeperFeeBps()) / 10_000;
                ghostPulled[post.subscriber] += newCharges * price;
                ghostCredited[payee] += newCharges * (price - fee);
                ghostCredited[k] += newCharges * fee;
            }
            _markTerminal(ids[i]);
        }
    }

    function _accountOne(uint256 subId, SubscriptionVault.Subscription memory pre, uint256 balBefore, address k)
        internal
    {
        if (pre.subscriber == address(0)) return;
        uint256 balAfter = usdc.balanceOf(pre.subscriber);
        if (balAfter < balBefore) {
            if (ghostTerminal[subId]) ghostChargedAfterTerminal = true;
            (address payee,, uint96 price,,,) = registry.getPlanTerms(pre.planId);
            uint256 pulled = balBefore - balAfter;
            uint256 fee = (uint256(price) * vault.keeperFeeBps()) / 10_000;
            ghostPulled[pre.subscriber] += pulled;
            ghostCredited[payee] += pulled - fee;
            ghostCredited[k] += fee;
        }
        _markTerminal(subId);
    }

    function _markTerminal(uint256 subId) internal {
        SubscriptionVault.Subscription memory s = vault.getSubscription(subId);
        if (
            !ghostTerminal[subId]
                && (s.status == SubscriptionVault.Status.Cancelled || s.status == SubscriptionVault.Status.Lapsed)
        ) {
            ghostTerminal[subId] = true;
            ghostTerminalCount[subId] = s.chargeCount;
        }
    }

    // ------------------------------------------------------------------ views for invariants

    function allAccounts() public view returns (address[] memory accts) {
        accts = new address[](payees.length + keepers.length + subscribers.length + 1);
        uint256 k;
        for (uint256 i; i < payees.length; ++i) accts[k++] = payees[i];
        for (uint256 i; i < keepers.length; ++i) accts[k++] = keepers[i];
        for (uint256 i; i < subscribers.length; ++i) accts[k++] = subscribers[i];
        accts[k] = attacker;
    }

    function subscriberCount() external view returns (uint256) {
        return subscribers.length;
    }

    function planCount() external view returns (uint256) {
        return planIds.length;
    }
}
