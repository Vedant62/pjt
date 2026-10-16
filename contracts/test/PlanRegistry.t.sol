// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PlanRegistry} from "../src/PlanRegistry.sol";

contract PlanRegistryTest is Test {
    PlanRegistry registry;
    address provider = makeAddr("provider");
    address payee = makeAddr("payee");
    address token = makeAddr("token");

    event PlanCreated(
        uint256 indexed planId,
        address indexed provider,
        address indexed payee,
        address token,
        uint96 price,
        uint32 period,
        uint32 gracePeriod,
        string metadataURI
    );
    event PlanActiveSet(uint256 indexed planId, bool active);

    function setUp() public {
        registry = new PlanRegistry();
    }

    function test_CreatePlan() public {
        vm.expectEmit(address(registry));
        emit PlanCreated(1, provider, payee, token, 20e6, 180, 60, "uri");
        vm.prank(provider);
        uint256 id = registry.createPlan(token, 20e6, 180, 60, payee, "uri");
        assertEq(id, 1);
        assertEq(registry.planCount(), 1);

        PlanRegistry.Plan memory p = registry.getPlan(id);
        assertEq(p.provider, provider);
        assertEq(p.payee, payee);
        assertEq(p.token, token);
        assertEq(p.price, 20e6);
        assertEq(p.period, 180);
        assertEq(p.gracePeriod, 60);
        assertTrue(p.active);
        assertEq(p.metadataURI, "uri");

        (address pe, address tk, uint96 pr, uint32 per, uint32 gr, bool act) = registry.getPlanTerms(id);
        assertEq(pe, payee);
        assertEq(tk, token);
        assertEq(pr, 20e6);
        assertEq(per, 180);
        assertEq(gr, 60);
        assertTrue(act);
    }

    function test_PlanIdsIncrement() public {
        assertEq(registry.createPlan(token, 1, 2, 1, payee, ""), 1);
        assertEq(registry.createPlan(token, 1, 2, 1, payee, ""), 2);
        assertEq(registry.planCount(), 2);
    }

    function test_RevertWhen_GraceEqualsPeriod() public {
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.GraceNotLessThanPeriod.selector, 180, 180));
        registry.createPlan(token, 20e6, 180, 180, payee, "");
    }

    function test_RevertWhen_GraceExceedsPeriod() public {
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.GraceNotLessThanPeriod.selector, 200, 180));
        registry.createPlan(token, 20e6, 180, 200, payee, "");
    }

    function test_RevertWhen_ZeroPeriod() public {
        vm.expectRevert(PlanRegistry.ZeroPeriod.selector);
        registry.createPlan(token, 20e6, 0, 0, payee, "");
    }

    function test_RevertWhen_ZeroPrice() public {
        vm.expectRevert(PlanRegistry.ZeroPrice.selector);
        registry.createPlan(token, 0, 180, 60, payee, "");
    }

    function test_RevertWhen_ZeroToken() public {
        vm.expectRevert(PlanRegistry.ZeroAddress.selector);
        registry.createPlan(address(0), 20e6, 180, 60, payee, "");
    }

    function test_RevertWhen_ZeroPayee() public {
        vm.expectRevert(PlanRegistry.ZeroAddress.selector);
        registry.createPlan(token, 20e6, 180, 60, address(0), "");
    }

    function test_SetPlanActive() public {
        vm.prank(provider);
        uint256 id = registry.createPlan(token, 20e6, 180, 60, payee, "");
        vm.expectEmit(address(registry));
        emit PlanActiveSet(id, false);
        vm.prank(provider);
        registry.setPlanActive(id, false);
        assertFalse(registry.getPlan(id).active);
        vm.prank(provider);
        registry.setPlanActive(id, true);
        assertTrue(registry.getPlan(id).active);
    }

    function test_RevertWhen_NonProviderSetsActive() public {
        vm.prank(provider);
        uint256 id = registry.createPlan(token, 20e6, 180, 60, payee, "");
        vm.expectRevert(PlanRegistry.NotProvider.selector);
        vm.prank(payee);
        registry.setPlanActive(id, false);
    }

    function test_RevertWhen_UnknownPlan() public {
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.UnknownPlan.selector, 0));
        registry.getPlan(0);
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.UnknownPlan.selector, 1));
        registry.getPlan(1);
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.UnknownPlan.selector, 7));
        registry.getPlanTerms(7);
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.UnknownPlan.selector, 7));
        registry.setPlanActive(7, false);
    }

    /// @dev The terms are immutable: the contract exposes no setter for price/period/token/payee.
    function test_NoTermSetters() public view {
        bytes4[4] memory forbidden = [
            bytes4(keccak256("setPrice(uint256,uint96)")),
            bytes4(keccak256("setPeriod(uint256,uint32)")),
            bytes4(keccak256("setPayee(uint256,address)")),
            bytes4(keccak256("setToken(uint256,address)"))
        ];
        for (uint256 i; i < forbidden.length; ++i) {
            (bool ok,) = address(registry).staticcall(abi.encodeWithSelector(forbidden[i], 1, 1));
            assertFalse(ok);
        }
    }
}
