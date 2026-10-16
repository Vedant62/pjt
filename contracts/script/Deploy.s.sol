// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PlanRegistry} from "../src/PlanRegistry.sol";
import {SubscriptionVault} from "../src/SubscriptionVault.sol";
import {UsageRootRegistry} from "../src/UsageRootRegistry.sol";

/// @notice Deploys all four contracts, authorises the gateway as root committer and writes
///         deployments/<chainId>.json. Env: PRIVATE_KEY (default: anvil #0), GATEWAY_ADDRESS (default: anvil #2).
contract Deploy is Script {
    uint16 constant KEEPER_FEE_BPS = 25;
    uint256 constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant ANVIL_ADDR_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function run() external {
        uint256 key = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
        address gateway = vm.envOr("GATEWAY_ADDRESS", ANVIL_ADDR_2);
        address deployer = vm.addr(key);
        uint256 startBlock = block.number;

        vm.startBroadcast(key);
        MockUSDC usdc = new MockUSDC();
        PlanRegistry registry = new PlanRegistry();
        SubscriptionVault vault = new SubscriptionVault(registry, KEEPER_FEE_BPS);
        UsageRootRegistry roots = new UsageRootRegistry(deployer);
        roots.setCommitter(gateway, true);
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", startBlock);
        vm.serializeUint(o, "keeperFeeBps", KEEPER_FEE_BPS);
        vm.serializeAddress(o, "deployer", deployer);
        vm.serializeAddress(o, "gateway", gateway);
        vm.serializeAddress(o, "MockUSDC", address(usdc));
        vm.serializeAddress(o, "PlanRegistry", address(registry));
        vm.serializeAddress(o, "SubscriptionVault", address(vault));
        string memory json = vm.serializeAddress(o, "UsageRootRegistry", address(roots));
        vm.writeJson(json, _path());

        console.log("MockUSDC          ", address(usdc));
        console.log("PlanRegistry      ", address(registry));
        console.log("SubscriptionVault ", address(vault));
        console.log("UsageRootRegistry ", address(roots));
    }

    function _path() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    }
}
