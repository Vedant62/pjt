// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

/// @notice Placeholder kept for the SPEC §7 file layout. The batch gas sweep is measured with REAL
///         transactions by `sim/src/batch-sweep.ts` (`pnpm results:local`), because a forge-script simulation
///         keeps storage warm across top-level calls and omits intrinsic/calldata gas, which would
///         under-report what a keeper pays. See docs/REPORT_NOTES.md ("Deviations").
contract GasSweep is Script {
    function run() external pure {
        console.log("Run `pnpm --filter @cashew/sim batch-sweep` (receipt-based sweep) instead.");
    }
}
