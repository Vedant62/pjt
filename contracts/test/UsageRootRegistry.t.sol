// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base} from "./Base.t.sol";
import {UsageRootRegistry} from "../src/UsageRootRegistry.sol";

contract UsageRootRegistryTest is Base {
    event RootCommitted(
        uint256 indexed planId, uint64 indexed epoch, bytes32 root, uint64 rowCount, uint128 totalTokens, string uri
    );
    event CommitterSet(address indexed committer, bool allowed);

    function _row(uint64 epoch, address wallet, uint32 completion) internal pure returns (UsageRootRegistry.UsageRow memory) {
        return UsageRootRegistry.UsageRow({
            epoch: epoch,
            wallet: wallet,
            subId: 1,
            model: "qwen3:8b",
            promptTokens: 12,
            completionTokens: completion,
            requestHash: keccak256("req"),
            responseHash: keccak256("resp"),
            timestamp: 1_700_000_000
        });
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function test_SetCommitter() public {
        vm.expectEmit(address(roots));
        emit CommitterSet(address(1), true);
        roots.setCommitter(address(1), true);
        assertTrue(roots.isCommitter(address(1)));
        roots.setCommitter(address(1), false);
        assertFalse(roots.isCommitter(address(1)));
    }

    function test_RevertWhen_NonOwnerSetsCommitter() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        roots.setCommitter(attacker, true);
    }

    function test_CommitAndVerify() public {
        bytes32 l1 = roots.hashRow(_row(7, alice, 100));
        bytes32 l2 = roots.hashRow(_row(7, attacker, 50));
        bytes32 root = _hashPair(l1, l2);

        vm.expectEmit(address(roots));
        emit RootCommitted(planId, 7, root, 2, 262, "file://epochs/1-7.json");
        vm.prank(gateway);
        roots.commitRoot(planId, 7, root, 2, 262, "file://epochs/1-7.json");

        assertEq(roots.rootOf(planId, 7), root);
        UsageRootRegistry.EpochRecord memory e = roots.getEpoch(planId, 7);
        assertEq(e.rowCount, 2);
        assertEq(e.totalTokens, 262);
        assertEq(e.committer, gateway);
        assertEq(e.committedAt, block.timestamp);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = l2;
        assertTrue(roots.verifyRow(planId, 7, proof, l1));
        proof[0] = l1;
        assertTrue(roots.verifyRow(planId, 7, proof, l2));
        // Tampered row (different token count) fails.
        assertFalse(roots.verifyRow(planId, 7, proof, roots.hashRow(_row(7, attacker, 51))));
        // Wrong epoch fails.
        assertFalse(roots.verifyRow(planId, 8, proof, l2));
    }

    /// @dev Leaf hash must equal the OpenZeppelin StandardMerkleTree leaf:
    ///      keccak256(bytes.concat(keccak256(abi.encode(values...)))).
    function test_HashRowMatchesStandardLeaf() public view {
        UsageRootRegistry.UsageRow memory r = _row(3, alice, 9);
        bytes32 expected = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        r.epoch, r.wallet, r.subId, r.model, r.promptTokens, r.completionTokens,
                        r.requestHash, r.responseHash, r.timestamp
                    )
                )
            )
        );
        assertEq(roots.hashRow(r), expected);
    }

    function test_RevertWhen_NotCommitter() public {
        vm.expectRevert(UsageRootRegistry.NotCommitter.selector);
        vm.prank(attacker);
        roots.commitRoot(planId, 1, bytes32(uint256(1)), 1, 1, "");
    }

    function test_RevertWhen_ZeroRoot() public {
        vm.expectRevert(UsageRootRegistry.ZeroRoot.selector);
        vm.prank(gateway);
        roots.commitRoot(planId, 1, bytes32(0), 1, 1, "");
    }

    function test_RevertWhen_EpochCommittedTwice() public {
        vm.startPrank(gateway);
        roots.commitRoot(planId, 1, bytes32(uint256(1)), 1, 1, "");
        vm.expectRevert(abi.encodeWithSelector(UsageRootRegistry.RootAlreadyCommitted.selector, planId, 1));
        roots.commitRoot(planId, 1, bytes32(uint256(2)), 1, 1, "");
        vm.stopPrank();
    }

    function test_VerifyUncommittedEpochFalse() public view {
        assertFalse(roots.verifyRow(planId, 1, new bytes32[](0), bytes32(uint256(1))));
    }
}
