// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title MockUSDC
/// @notice Testnet settlement token: 6 decimals, ERC-2612 permit, open faucet mint.
contract MockUSDC is ERC20, ERC20Permit {
    /// @notice Maximum amount mintable per call (1,000 mUSDC).
    uint256 public constant MAX_MINT = 1_000 * 1e6;

    error MintCapExceeded(uint256 requested, uint256 cap);

    constructor() ERC20("Mock USD Coin", "mUSDC") ERC20Permit("Mock USD Coin") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open faucet. Anyone may mint up to MAX_MINT per call.
    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintCapExceeded(amount, MAX_MINT);
        _mint(to, amount);
    }
}
