# Appendix B — Deviations from the Specification

Every deviation from `SPEC.md`, with its reason. Copied from `docs/REPORT_NOTES.md` §2.

| # | Deviation | Why |
|---|---|---|
| D1 | Added `PlanRegistry.getPlanTerms` | Lets the vault read terms without copying the metadata string, which saves gas. Purely additive. |
| D2 | Vault caches plan terms on first use (`_terms[planId]`) | Terms are immutable, so caching is safe and turns an external call into two SLOADs per charge. `active` is still read live at subscribe time. |
| D3 | Added `latestSubOf` | The gateway's 402 body must report the on-chain status and subId even when `entitledSubOf` returns 0. |
| D4 | Added `UsageRootRegistry.getEpoch` and `hashRow` | `hashRow` lets anyone (and the dashboard) recompute a StandardMerkleTree leaf on-chain. The gateway e2e test checks JS leaf == Solidity leaf. |
| D5 | `createPlan` rejects `price == 0` and zero addresses | A zero price makes the fee arithmetic and the attack properties vacuous. |
| D6 | `cancel` on a non-live sub reverts `NotChargeable(status)` | The spec didn't define this case. Reusing the existing error keeps the ABI small. |
| D7 | The initial payment counts as charge #1 (`chargeCount = 1` after subscribe) | This makes I4 (`nextChargeAt == startedAt + period × chargeCount`) and the fuzz property (`startedAt + (k+1)·period` after k keeper charges) hold at the same time. |
| D8 | Status check before due check in `charge` | A cancelled sub reverts `NotChargeable(Cancelled)` even before its due time, which is more informative for the attack panel. Both errors still occur exactly as specified. |
| D9 | SIWE uses viem's EIP-4361 implementation (`viem/siwe`, `verifySiweMessage`) instead of the `siwe` npm package | The `siwe` package needs an ethers peer dependency. viem is already used everywhere and also supports ERC-6492 smart-account signatures. |
| D10 | Batch gas sweep uses real anvil transactions (`sim/src/batch-sweep.ts`); `GasSweep.s.sol` is a pointer | A forge-script simulation keeps storage warm across top-level calls and omits intrinsic and calldata gas, so it under-reports keeper cost. Receipts are the honest number. |
| D11 | `results/gas_report.*` is generated from unit tests only | Fuzz inputs and invariant-handler calls skew min/avg/max. Receipt gas is reported separately. |
| D12 | Node 22 used for development (spec: Node 20) | It was the installed version. Nothing uses Node-22-only APIs; `engines` says ≥ 20. |
| D13 | Foundry installed via Homebrew (1.8.5) | The `foundryup` download was blocked by the sandbox network policy. |
| D14 | matplotlib 3.10.7 (not 3.9) | 3.9 fails on Python 3.14 (infinite recursion in `deepcopy`). |
| D15 | Gateway API keys can only be minted with a SIWE JWT, not with another `csk_` key | A leaked key then can't mint more keys. |
| D16 | `responseHash = keccak256(assistant message content)`, `requestHash = keccak256(canonical JSON of the forwarded body, keys sorted)` | The spec says "full response text". For streams the concatenated deltas are hashed, so streaming and non-streaming hash the same way. |
| D17 | Usage rows carry `usageSource` (`upstream` / `estimated`) | If AIPG omits the usage block, tokens are estimated (chars/4) and flagged rather than silently invented. The flag is not part of the leaf. |
| D18 | Dashboard: anvil-only "dev wallets" | Lets the local demo and fallback run without a browser extension. They use only the public anvil keys, only on chain 31337, and are disabled in `testnet:up`. |
| D19 | `local:up` seeds one cancelled subscription | Gives attack #3 a target immediately. |
| D20 | Testnet is Ethereum Sepolia (11155111) instead of Base Sepolia | No Base Sepolia faucet was usable without mainnet ETH. The contracts are chain-agnostic, and Base Sepolia (84532) is still supported (`--chain 84532`). `cost_model.json` still uses the measured Base Sepolia gas price, so the cost analysis applies to Base. |
| D21 | Testnet deploys use `forge script --skip-simulation` | At deployment time, Sepolia charged about 5× the cancun price for contract creation (receipts: MockUSDC 6.53M gas, SubscriptionVault 11.65M gas), so Forge's local gas simulation ran out of gas twice. With `--skip-simulation`, Forge takes gas limits from the node's `eth_estimateGas`. Local and anvil gas figures in `results/` are cancun-priced. Base Sepolia and Base mainnet pricing still applies to the cost model. |

> If further deviations are recorded in `docs/REPORT_NOTES.md` after this draft (for example from the lifecycle-script fix), copy them here.
