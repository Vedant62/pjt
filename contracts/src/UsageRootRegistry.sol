// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title UsageRootRegistry
/// @notice Gateways commit one Merkle root of metered usage rows per (planId, epoch).
///         Leaves follow the OpenZeppelin merkle-tree JS library StandardMerkleTree (double-hashed) with type
///         ["uint64 epoch","address wallet","uint256 subId","string model","uint32 promptTokens",
///          "uint32 completionTokens","bytes32 requestHash","bytes32 responseHash","uint64 timestamp"].
contract UsageRootRegistry is Ownable {
    struct UsageRow {
        uint64 epoch;
        address wallet;
        uint256 subId;
        string model;
        uint32 promptTokens;
        uint32 completionTokens;
        bytes32 requestHash;
        bytes32 responseHash;
        uint64 timestamp;
    }

    struct EpochRecord {
        bytes32 root;
        uint64 rowCount;
        uint128 totalTokens;
        uint64 committedAt;
        address committer;
        string uri;
    }

    mapping(address => bool) public isCommitter;
    mapping(uint256 planId => mapping(uint64 epoch => EpochRecord)) private _epochs;

    event CommitterSet(address indexed committer, bool allowed);
    event RootCommitted(
        uint256 indexed planId, uint64 indexed epoch, bytes32 root, uint64 rowCount, uint128 totalTokens, string uri
    );

    error NotCommitter();
    error ZeroRoot();
    error RootAlreadyCommitted(uint256 planId, uint64 epoch);

    constructor(address owner_) Ownable(owner_) {}

    function setCommitter(address committer, bool allowed) external onlyOwner {
        isCommitter[committer] = allowed;
        emit CommitterSet(committer, allowed);
    }

    function commitRoot(
        uint256 planId,
        uint64 epoch,
        bytes32 root,
        uint64 rowCount,
        uint128 totalTokens,
        string calldata uri
    ) external {
        if (!isCommitter[msg.sender]) revert NotCommitter();
        if (root == bytes32(0)) revert ZeroRoot();
        EpochRecord storage e = _epochs[planId][epoch];
        if (e.root != bytes32(0)) revert RootAlreadyCommitted(planId, epoch);
        e.root = root;
        e.rowCount = rowCount;
        e.totalTokens = totalTokens;
        e.committedAt = uint64(block.timestamp);
        e.committer = msg.sender;
        e.uri = uri;
        emit RootCommitted(planId, epoch, root, rowCount, totalTokens, uri);
    }

    /// @notice Verify a (double-hashed) StandardMerkleTree leaf against the committed root.
    function verifyRow(uint256 planId, uint64 epoch, bytes32[] calldata proof, bytes32 leaf)
        external
        view
        returns (bool)
    {
        bytes32 root = _epochs[planId][epoch].root;
        if (root == bytes32(0)) return false;
        return MerkleProof.verifyCalldata(proof, root, leaf);
    }

    function rootOf(uint256 planId, uint64 epoch) external view returns (bytes32) {
        return _epochs[planId][epoch].root;
    }

    function getEpoch(uint256 planId, uint64 epoch) external view returns (EpochRecord memory) {
        return _epochs[planId][epoch];
    }

    /// @notice StandardMerkleTree leaf hash of a usage row, so anyone can recompute it on-chain.
    function hashRow(UsageRow calldata r) external pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        r.epoch,
                        r.wallet,
                        r.subId,
                        r.model,
                        r.promptTokens,
                        r.completionTokens,
                        r.requestHash,
                        r.responseHash,
                        r.timestamp
                    )
                )
            )
        );
    }
}
