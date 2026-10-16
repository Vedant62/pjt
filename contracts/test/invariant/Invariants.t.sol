// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {PlanRegistry} from "../../src/PlanRegistry.sol";
import {SubscriptionVault} from "../../src/SubscriptionVault.sol";
import {Handler} from "./Handler.sol";

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
contract InvariantsTest is StdInvariant, Test {
    MockUSDC usdc;
    PlanRegistry registry;
    SubscriptionVault vault;
    Handler handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        registry = new PlanRegistry();
        vault = new SubscriptionVault(registry, 25);
        handler = new Handler(usdc, registry, vault);
        targetContract(address(handler));
    }

    /// I1: for every subscriber, total pulled <= Σ_subs price × (1 + floor((now - startedAt)/period)).
    function invariant_I1_noOvercharge() public view {
        uint256 n = vault.subscriptionCount();
        for (uint256 i; i < handler.subscriberCount(); ++i) {
            address who = handler.subscribers(i);
            uint256 bound_;
            for (uint256 id = 1; id <= n; ++id) {
                SubscriptionVault.Subscription memory s = vault.getSubscription(id);
                if (s.subscriber != who) continue;
                (,, uint96 price, uint32 period,,) = registry.getPlanTerms(s.planId);
                bound_ += uint256(price) * (1 + (block.timestamp - s.startedAt) / period);
            }
            assertLe(handler.ghostPulled(who), bound_, "I1 overcharge");
        }
    }

    /// I2: no successful charge ever happens after a subscription is Cancelled or Lapsed.
    function invariant_I2_noChargeAfterTerminal() public view {
        assertFalse(handler.ghostChargedAfterTerminal(), "I2 charged after terminal");
        uint256 n = vault.subscriptionCount();
        for (uint256 id = 1; id <= n; ++id) {
            if (!handler.ghostTerminal(id)) continue;
            SubscriptionVault.Subscription memory s = vault.getSubscription(id);
            assertEq(s.chargeCount, handler.ghostTerminalCount(id), "I2 chargeCount moved");
            assertTrue(
                s.status == SubscriptionVault.Status.Cancelled || s.status == SubscriptionVault.Status.Lapsed,
                "I2 left terminal state"
            );
        }
    }

    /// I3: vault token balance == Σ claimable.
    function invariant_I3_solvency() public view {
        address[] memory accts = handler.allAccounts();
        uint256 sum;
        for (uint256 i; i < accts.length; ++i) sum += vault.claimable(accts[i], address(usdc));
        assertEq(usdc.balanceOf(address(vault)), sum, "I3 insolvent");
    }

    /// I4: nextChargeAt == startedAt + period × chargeCount for every subscription.
    function invariant_I4_anchoredSchedule() public view {
        uint256 n = vault.subscriptionCount();
        for (uint256 id = 1; id <= n; ++id) {
            SubscriptionVault.Subscription memory s = vault.getSubscription(id);
            (,,, uint32 period,,) = registry.getPlanTerms(s.planId);
            assertEq(s.nextChargeAt, uint256(s.startedAt) + uint256(period) * s.chargeCount, "I4 schedule drift");
        }
    }

    /// I5: no account ever withdraws more than it was credited; the attacker is never paid.
    function invariant_I5_ownFundsOnly() public view {
        address[] memory accts = handler.allAccounts();
        for (uint256 i; i < accts.length; ++i) {
            address a = accts[i];
            assertLe(handler.ghostWithdrawn(a), handler.ghostCredited(a), "I5 withdrew more than credited");
            assertEq(
                handler.ghostCredited(a) - handler.ghostWithdrawn(a),
                vault.claimable(a, address(usdc)),
                "I5 claimable mismatch"
            );
        }
        assertFalse(handler.ghostAttackerWithdrew(), "I5 attacker withdrew");
    }

    function afterInvariant() external view {
        uint256 n = vault.subscriptionCount();
        uint256 charges;
        uint256[5] memory byStatus;
        for (uint256 id = 1; id <= n; ++id) {
            SubscriptionVault.Subscription memory s = vault.getSubscription(id);
            charges += s.chargeCount - 1;
            byStatus[uint8(s.status)]++;
        }
        console.log("subscriptions", n, "keeper charges", charges);
        console.log("active/pastDue", byStatus[1], byStatus[2]);
        console.log("lapsed/cancelled", byStatus[3], byStatus[4]);
        console.log("charge calls", handler.calls("charge"), "batch calls", handler.calls("chargeBatch"));
    }
}
