// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC usdc;

    function setUp() public {
        usdc = new MockUSDC();
    }

    function test_Metadata() public view {
        assertEq(usdc.name(), "Mock USD Coin");
        assertEq(usdc.symbol(), "mUSDC");
        assertEq(usdc.decimals(), 6);
    }

    function test_MintOpenToAnyone() public {
        vm.prank(makeAddr("rando"));
        usdc.mint(address(0xBEEF), 1_000e6);
        assertEq(usdc.balanceOf(address(0xBEEF)), 1_000e6);
    }

    function test_RevertWhen_MintAboveCap() public {
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.MintCapExceeded.selector, 1_000e6 + 1, 1_000e6));
        usdc.mint(address(this), 1_000e6 + 1);
    }

    function test_PermitSetsAllowance() public {
        uint256 key = 0xB0B;
        address owner = vm.addr(key);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(this),
                123,
                0,
                block.timestamp + 1
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
        usdc.permit(owner, address(this), 123, block.timestamp + 1, v, r, s);
        assertEq(usdc.allowance(owner, address(this)), 123);
    }
}
