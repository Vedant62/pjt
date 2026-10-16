// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PlanRegistry} from "../src/PlanRegistry.sol";

/// @notice Creates the demo plan (20 mUSDC / 180 s / 60 s grace) and a production-shaped plan
///         (20 mUSDC / 30 days / 3 days grace), and mints mUSDC to the subscriber test wallets.
///         Env: PRIVATE_KEY (default anvil #0), SUBSCRIBER_ADDRESSES (default anvil #3,#4,#5), PAYEE (default deployer).
contract Seed is Script {
    uint256 constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint96 constant PRICE = 20e6;

    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        string memory dep = vm.readFile(path);
        MockUSDC usdc = MockUSDC(vm.parseJsonAddress(dep, ".MockUSDC"));
        PlanRegistry registry = PlanRegistry(vm.parseJsonAddress(dep, ".PlanRegistry"));

        uint256 key = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);
        address payee = vm.envOr("PAYEE", vm.addr(key));
        address[] memory defaults = new address[](3);
        defaults[0] = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
        defaults[1] = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
        defaults[2] = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;
        address[] memory subs = vm.envOr("SUBSCRIBER_ADDRESSES", ",", defaults);

        vm.startBroadcast(key);
        uint256 demo = registry.createPlan(
            address(usdc),
            PRICE,
            180,
            60,
            payee,
            'data:application/json,{"name":"AI Power Grid Access \\u2014 demo cadence","description":"OpenAI-compatible access to AI Power Grid via the Cashew Gateway. 180 s period for live demos.","features":["qwen3:8b","qwen3:4b","qwen3:1.7b"]}'
        );
        uint256 prod = registry.createPlan(
            address(usdc),
            PRICE,
            30 days,
            3 days,
            payee,
            'data:application/json,{"name":"AI Power Grid Access \\u2014 monthly","description":"Production-shaped plan: 30-day period, 3-day grace.","features":["qwen3:8b","qwen3:4b","qwen3:1.7b"]}'
        );
        for (uint256 i; i < subs.length; ++i) {
            usdc.mint(subs[i], 1_000e6);
        }
        vm.stopBroadcast();

        string memory o = "seed";
        vm.serializeUint(o, "demoPlanId", demo);
        string memory json = vm.serializeUint(o, "prodPlanId", prod);
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".seed.json"));
        console.log("demo plan", demo, "prod plan", prod);
    }
}
