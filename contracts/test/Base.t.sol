// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PlanRegistry} from "../src/PlanRegistry.sol";
import {SubscriptionVault} from "../src/SubscriptionVault.sol";
import {UsageRootRegistry} from "../src/UsageRootRegistry.sol";

abstract contract Base is Test {
    MockUSDC internal usdc;
    PlanRegistry internal registry;
    SubscriptionVault internal vault;
    UsageRootRegistry internal roots;

    address internal provider = makeAddr("provider");
    address internal payee = makeAddr("payee");
    address internal keeper = makeAddr("keeper");
    address internal attacker = makeAddr("attacker");
    address internal gateway = makeAddr("gateway");
    uint256 internal aliceKey = 0xA11CE;
    address internal alice = vm.addr(aliceKey);

    uint96 internal constant PRICE = 20e6;
    uint32 internal constant PERIOD = 180;
    uint32 internal constant GRACE = 60;
    uint16 internal constant FEE_BPS = 25;

    uint256 internal planId;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        registry = new PlanRegistry();
        vault = new SubscriptionVault(registry, FEE_BPS);
        roots = new UsageRootRegistry(address(this));
        roots.setCommitter(gateway, true);

        vm.prank(provider);
        planId = registry.createPlan(address(usdc), PRICE, PERIOD, GRACE, payee, "ipfs://demo");

        usdc.mint(alice, 1_000e6);
    }

    function _signPermit(uint256 key, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, usdc.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(key, digest);
    }

    function _subscribeAlice() internal returns (uint256 subId) {
        vm.startPrank(alice);
        usdc.approve(address(vault), uint256(PRICE) * 12);
        subId = vault.subscribe(planId);
        vm.stopPrank();
    }

    function _fee(uint256 price) internal pure returns (uint256) {
        return (price * FEE_BPS) / 10_000;
    }
}
