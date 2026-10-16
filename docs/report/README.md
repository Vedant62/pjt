# Cashew — B.Tech Capstone Project Report (Markdown draft)

Draft written 2026-10-16. Every number is copied from a named file in `results/` or `docs/REPORT_NOTES.md` (or PROGRESS.md for coverage and the gateway e2e count), and the source is cited under each table. Nothing has been estimated or invented. Items that are not measured yet appear as **`[PENDING: …]`** blocks.

## What the student still has to supply

**Pending results** (re-check `results/` before finalising; copy numbers only from the files):

- [ ] `results/lifecycle_testnet.json`: Sepolia lifecycle run (in progress in another session). Fill §9.7 and the abstract/conclusion sentences. **The first `subscribeWithPermit` row records the wrong status (script bug being fixed)**: use a fixed re-run or footnote that row.
- [ ] `results/gateway_bench.json` + `results/fig_ttft.png`: live AIPG benchmark, not run. It is blocked because no qwen3 worker was online at snapshot time (`grid_snapshot.json`). Fill §9.9, the NF5 row in §9.11, the abstract and the conclusion.
- [ ] `results/epochs.json`: committed testnet epochs with one verified proof. Fill §9.10.
- [ ] Re-run `pnpm results:summary` so `results/RESULTS.md` includes `grid_snapshot.json` (its §8 currently still says "not present"; see the note at the top of Chapter 9).

**Figures:**

- [ ] `docs/screenshots/` is empty. Add Playwright 1440×900 captures of every dashboard page, the 402 banner and the attack-panel results (§6.3 placeholder).
- [ ] One Etherscan "verified source" screenshot (Appendix D).
- [ ] Optional: `forge coverage` table output and `pnpm test:gateway` console output, because coverage and the 10 gateway e2e tests are recorded only in PROGRESS.md, not in a results file (§8.3, §8.4).
- [ ] Render the Mermaid diagrams in Chapter 4 to images if your template or Word export does not render Mermaid.

**Literature:** every external reference is marked **[VERIFY]** (Chapter 2, Chapter 10, [references.md](references.md)). Check each against the primary source, fix the details, convert to your citation style, and delete any you cannot verify, especially R21 (the approval-drain incident) and R16 (AI Power Grid).

**Personal and institutional details** ([00-front-matter.md](00-front-matter.md)): name(s), roll number(s), department, college, guide and designation, academic year, certificate/declaration/acknowledgements per the institution's template, and the hardware used for the experiments (§9.1).

**Small checks flagged inline with `[STUDENT: …]`:** the `/epochs/:epoch/rows` privacy note (Appendix A) and the coverage re-run (§8.3).

## Table of contents

| | Chapter | File |
|---|---|---|
| — | Title page, abstract, abbreviations | [00-front-matter.md](00-front-matter.md) |
| 1 | Introduction | [01-introduction.md](01-introduction.md) |
| 2 | Background and related work | [02-background.md](02-background.md) |
| 3 | Requirements and design goals | [03-requirements.md](03-requirements.md) |
| 4 | System architecture | [04-architecture.md](04-architecture.md) |
| 5 | Smart contract design | [05-contracts.md](05-contracts.md) |
| 6 | Off-chain components (keeper, gateway, dashboard) | [06-offchain.md](06-offchain.md) |
| 7 | Security analysis and threat model | [07-security.md](07-security.md) |
| 8 | Implementation and testing | [08-implementation-testing.md](08-implementation-testing.md) |
| 9 | Evaluation and results | [09-evaluation.md](09-evaluation.md) |
| 10 | Limitations and future work | [10-limitations-future.md](10-limitations-future.md) |
| 11 | Conclusion | [11-conclusion.md](11-conclusion.md) |
| A | Contract and gateway interfaces | [appendix-a-interfaces.md](appendix-a-interfaces.md) |
| B | Deviations from the specification (D1–D21) | [appendix-b-deviations.md](appendix-b-deviations.md) |
| C | Tool and library versions | [appendix-c-versions.md](appendix-c-versions.md) |
| D | Deployed addresses and verification | [appendix-d-deployments.md](appendix-d-deployments.md) |
| — | References | [references.md](references.md) |

## Source map (where each number comes from)

| Results used | File |
|---|---|
| Test counts, fuzz runs, invariant runs × depth, KeeperCannot and I1–I5 status | `results/test_summary.json` |
| Gas per operation | `results/gas_report.json` / `.md` |
| Batch sweep, single-charge and first-charge gas | `results/batch_sweep.json`, `results/fig_batch_sweep.png` |
| Cost per operation, gas price, assumptions, keeper fee in USD | `results/cost_model.json`, `results/RESULTS.md` §4 |
| Keeper drift, missed/lost, txs, gas per charge | `results/schedule_sim.json`, `results/fig_drift_cdf.png` |
| Outage recovery | `results/keeper_outage.json` |
| AIPG workers and models | `results/grid_snapshot.json` |
| 62.0 % batch reduction | `results/RESULTS.md` §3 |
| Coverage 100 %; 10 gateway e2e tests; drift 4 s in the local walk-through | `PROGRESS.md` |
| Deviations, threat model, limitations, versions, addresses, Sepolia creation gas (6.53M / 11.65M) | `docs/REPORT_NOTES.md` |

Derived figures (computed by the author from the files above, not printed in them): the 8 % "worst 6-hour drift vs. 3-day grace" ratio (§9.5), the ~27.4k marginal gas per subscriber between batch 100 and 200 (§9.3), and 500 × 11 = 5,500 due charges (§9.5, from the rule in `sim/src/schedule.ts`).

## Important framing for the viva

- The testnet is **Ethereum Sepolia (11155111)**, not Base Sepolia (D20). The **cost model prices gas on Base Sepolia** and does not measure Ethereum costs.
- **Gas tables come from anvil (EVM cancun)**. Sepolia receipts can be higher (D21: contract creation was about 5× at deploy time).
- Limitations to state up front: trusted gateway metering, a single shared AIPG key, mock token, no audit, testnet only.
