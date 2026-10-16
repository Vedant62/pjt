# Appendix D — Deployed Addresses and Verification

Copied from `docs/REPORT_NOTES.md` §7.

## Ethereum Sepolia (chainId 11155111)

Deployed from `0xdb0C7Acf5560eA87eD7D5D7C570dF21092ac62E7` starting at block 11925719. Committer (gateway) `0x6c9e15ce9e9B812d7746DDab4926b2eBFE9fade2`, keeper fee 25 bps. Seeded demo plan #1 (20 mUSDC / 180 s / 60 s) and production-shaped plan #2 (20 mUSDC / 30 d / 3 d). Deployment receipts: `contracts/broadcast/{Deploy,Seed}.s.sol/11155111/run-latest.json`.

| Contract | Address | Etherscan |
|---|---|---|
| MockUSDC | `0x75e8B2f30a7c08cf3967A2745dFAb0CF418Ced96` | [verified](https://sepolia.etherscan.io/address/0x75e8B2f30a7c08cf3967A2745dFAb0CF418Ced96#code) |
| PlanRegistry | `0x9109E3Af83D6499E4d433128B60CDAc5505Cc815` | [verified](https://sepolia.etherscan.io/address/0x9109E3Af83D6499E4d433128B60CDAc5505Cc815#code) |
| SubscriptionVault | `0x9bC880415C54122cB64463888Db6a94Bf285dB8a` | [verified](https://sepolia.etherscan.io/address/0x9bC880415C54122cB64463888Db6a94Bf285dB8a#code) |
| UsageRootRegistry | `0x3fF143e67616114B4F638b332BaF060Cb8e8696C` | [verified](https://sepolia.etherscan.io/address/0x3fF143e67616114B4F638b332BaF060Cb8e8696C#code) |

> **[STUDENT TO SUPPLY]** A screenshot of one Etherscan "Contract Source Code Verified" page (e.g. SubscriptionVault) as a figure.

## Local anvil (deterministic, chainId 31337)

| Contract | Address |
|---|---|
| MockUSDC | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| PlanRegistry | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| SubscriptionVault | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| UsageRootRegistry | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |

## Base Sepolia (chainId 84532)

Not deployed (deviation D20). The deploy scripts support it with `--chain 84532`.
