# Chapter 8 — Implementation and Testing

## 8.1 Repository and build

The project is a pnpm workspace (`package.json`, `pnpm-workspace.yaml`):

```
contracts/       Foundry: MockUSDC, PlanRegistry, SubscriptionVault, UsageRootRegistry + tests + scripts
packages/shared/ generated ABIs + addresses.json — the only place addresses live
keeper/          permissionless keeper service (Node/TS, viem)
gateway/         entitlement gateway, metering, epoch roots (Express, SQLite, merkle-tree)
dashboard/       Next.js 14 + wagmi + RainbowKit
sim/             experiments, benchmarks, plots
results/         machine-written results + RESULTS.md
docs/            architecture, demo runbook, report notes, this report
```

OpenZeppelin Contracts 5.1.0 and forge-std 1.17.0 are vendored under `contracts/lib/` (sources only, no git submodules) so a fresh clone builds offline (PROGRESS.md, Phase 1). Tool versions are in Appendix C.

Contract source sizes (lines, including comments): `MockUSDC.sol` 26, `PlanRegistry.sol` 100, `SubscriptionVault.sol` 327, `UsageRootRegistry.sol` 113 (`wc -l contracts/src/*.sol`).

### Top-level commands

| Command | Does |
|---|---|
| `pnpm test:contracts` | `forge test -vvv` |
| `pnpm local:up` | anvil + deploy + seed + ABI sync + keeper + gateway (mock) + dashboard |
| `pnpm deploy:testnet` | deploy + seed + Etherscan-verify on the testnet, sync ABIs |
| `pnpm testnet:up` | keeper + gateway + dashboard against the testnet |
| `pnpm results:local` | test_summary, gas_report, batch_sweep, cost_model, schedule_sim, keeper_outage |
| `pnpm results:testnet` | lifecycle_testnet, grid_snapshot, gateway_bench (asks before live calls), epochs |
| `pnpm results:summary` | plots + `results/RESULTS.md` |

## 8.2 Development process

The work followed eight phases from `SPEC.md` §9, committing after each phase's checks passed (PROGRESS.md):

1. Scaffold. 2. Contracts and full test suite. 3. Local stack (deploy/seed scripts, keeper, gateway in mock mode). 4. Dashboard. 5. Local experiments. 6. Testnet. 7. Live AIPG. 8. Documentation.

Phases 1–5 are complete. Phase 6 is partly complete: deployment and verification on Ethereum Sepolia are done, and the lifecycle run is in progress. Phase 7 is blocked until a qwen3 worker is online on AIPG (§9.8). Every deviation from the specification is recorded with its reason (Appendix B).

## 8.3 Contract test suite

| Kind | Total | Passed | Failed | Configuration |
|---|---:|---:|---:|---|
| Unit | 68 | 68 | 0 | — |
| Fuzz | 3 | 3 | 0 | 1,000 runs each |
| Invariant campaign | 1 | 1 | 0 | 256 runs × depth 64 = 16,384 calls, 0 reverts |
| — invariant predicates within the campaign | 5 | 5 | 0 | I1–I5 |
| **Total (as counted by `forge test`)** | **72** | **72** | **0** | |

*Source: `results/test_summary.json` (`totals`, `fuzz`, `invariant`), generated 2026-10-16T04:46:15.931Z at commit `4439796` (dirty tree). The "72 tests" total counts the invariant campaign once (68 + 3 + 1). Its five predicates are reported separately.*

Unit tests by file (counted from the `tests` array in `results/test_summary.json`):

| File | Unit tests | Highlights |
|---|---:|---|
| `MockUSDC.t.sol` | 4 | metadata, open mint, mint cap, permit sets allowance |
| `PlanRegistry.t.sol` | 12 | every revert (zero token/payee/price/period, grace = period, grace > period, unknown plan, non-provider), `test_NoTermSetters` |
| `SubscriptionVault.t.sol` | 44 | subscribe/permit/front-run, charge, batch, PastDue, recovery, lapse, late charge, catch-up, cancel, withdraw, entitlement transitions, the five `KeeperCannot` tests |
| `UsageRootRegistry.t.sol` | 8 | commit + verify, `hashRow` matches the StandardMerkleTree leaf, double commit, zero root, access control |
| **Total** | **68** | |

**Coverage.** `forge coverage --no-match-coverage '(^|/)(test|script)/'` reports 100 % lines, statements, branches and functions on `src/` (PROGRESS.md, Phase 2; `results/RESULTS.md` §1). The coverage figure is recorded in PROGRESS.md rather than in a machine-written results file. **[STUDENT: re-run `forge coverage` before submission and paste the table output as an appendix figure if the panel asks for evidence.]**

## 8.4 Gateway end-to-end tests

`pnpm test:gateway` runs 10 end-to-end tests (`gateway/test/e2e.test.ts`) against a running local chain (PROGRESS.md, Phase 3):

1. SIWE sign-in issues a JWT
2. Unauthenticated and unsubscribed requests are refused
3. Subscribe with one EIP-2612 permit
4. An entitled wallet gets a completion (non-stream) and a usage row
5. A streaming completion passes SSE through and records usage
6. Policy: model allowlist
7. `csk_` API keys work on `/v1` but cannot mint more keys
8. An epoch root is committed and a row's inclusion proof verifies on-chain (including JS leaf == Solidity `hashRow`)
9. A cancelled subscription is entitled until paid-through, then 402
10. Health reports mode, budget, epoch and cache

These results are recorded in PROGRESS.md; there is no machine-written results file for them. **[STUDENT: optionally re-run `pnpm test:gateway` and include the console output as a figure.]**

## 8.5 Manual end-to-end verification

The dashboard flow in `docs/DEMO.md` was walked in a browser against `pnpm local:up` in mock mode (PROGRESS.md, Phase 4): permit-subscribe (1 signature + 1 transaction) → SIWE sign-in → streamed chat with tokens and TTFT → keeper charged automatically (drift 4 s, shown in `/activity`) → epoch root committed → `/epochs` proof verified on-chain (✓; tamper → ✗) → attack panel: all five reverts decoded; "send for real" broadcast the reverting transaction.

## 8.6 Notable implementation decisions

- **Real receipts for batch gas** (D10). A `forge script` simulation keeps storage warm across top-level calls and omits intrinsic and calldata gas, so it under-reports keeper cost. The batch sweep therefore sends real transactions to anvil and reads `gasUsed` from receipts.
- **Gas report from unit tests only** (D11). Fuzz inputs and invariant-handler calls skew min/avg/max, so they are excluded.
- **Persisted live budget**, reserved before the upstream call (§6.2.2).
- **Estimated usage flagged, not hidden** (D17).

## 8.7 Testnet deployment

The contracts were deployed, seeded and source-verified on **Ethereum Sepolia (chainId 11155111)** (`docs/REPORT_NOTES.md` §7; addresses in Appendix D). Two deviations apply:

- **D20 — Ethereum Sepolia instead of Base Sepolia.** No Base Sepolia faucet was usable without mainnet ETH. The contracts are chain-agnostic, and Base Sepolia (84532) is still supported (`--chain 84532`).
- **D21 — `forge script --skip-simulation`.** At deployment time, Sepolia charged about 5× the cancun price for contract creation. Deployment receipts show MockUSDC at 6.53M gas and SubscriptionVault at 11.65M gas, so Forge's local gas simulation (cancun-priced) ran out of gas twice. With `--skip-simulation`, Forge takes gas limits from the node's `eth_estimateGas`.

**Consequence for this report:** all gas figures in Chapter 9 come from anvil with EVM version `cancun`. Receipts on Ethereum Sepolia may be higher than these figures (D21). The cost model (§9.4) uses the gas price measured on Base Sepolia, so it describes the cost on Base, not on Ethereum Sepolia or Ethereum mainnet.
