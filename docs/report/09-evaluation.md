# Chapter 9 — Evaluation and Results

Every number in this chapter is copied from a machine-written file in `results/`. The file is named under each table. Each JSON file records the script that produced it, its generation time (UTC) and the git commit. All local results were generated on 2026-10-16 at commit `4439796` with uncommitted changes present ("dirty tree"), as recorded in the files themselves.

> **Note on `results/RESULTS.md`.** That summary was generated at 2026-10-16T05:19:12Z, before `grid_snapshot.json` existed, so its §8 still says "null — not present". `grid_snapshot.json` now exists and is used directly in §9.8. **[STUDENT: re-run `pnpm results:summary` before submission so RESULTS.md matches the JSON files.]**

## 9.1 Experimental setup

| Item | Value | Source |
|---|---|---|
| Local chain | anvil (Foundry 1.8.5), chainId 31337, EVM `cancun` | `docs/REPORT_NOTES.md` §6; `contracts/foundry.toml` |
| Compiler | Solidity 0.8.24, optimizer 200 runs | `docs/REPORT_NOTES.md` §6 |
| Keeper fee | 25 bps | `results/batch_sweep.json` (`keeperFeeBps`) |
| Demo plan (sweep, outage) | price 20 mUSDC (20,000,000 units), period 180 s, grace 60 s | `results/batch_sweep.json`, `results/keeper_outage.json` |
| Production-shaped plan (schedule sim) | price 20 mUSDC, period 2,592,000 s (30 d), grace 259,200 s (3 d) | `results/schedule_sim.json` |
| Testnet | Ethereum Sepolia, chainId 11155111 | `docs/REPORT_NOTES.md` §7 |

**Hardware.** **[STUDENT TO SUPPLY: machine model, CPU, RAM, OS used for the runs.]** Wall-clock times below depend on it. Gas figures do not.

## 9.2 Gas per operation (Foundry gas report)

Execution gas per call, measured by Foundry across the unit tests. Reverting calls made inside tests are included, which is why the minimums are low. The figures exclude the 21,000 intrinsic gas and calldata gas.

| Operation | Contract | Calls | Min | Avg | Median | Max |
|---|---|---:|---:|---:|---:|---:|
| `createPlan` | PlanRegistry | 63 | 23,226 | 147,209 | 161,973 | 161,973 |
| `subscribeWithPermit` | SubscriptionVault | 3 | 213,051 | 252,454 | 253,892 | 290,419 |
| `subscribe` | SubscriptionVault | 43 | 36,446 | 204,235 | 241,640 | 241,640 |
| `charge` | SubscriptionVault | 30 | 29,057 | 61,712 | 46,360 | 94,772 |
| `chargeBatch` | SubscriptionVault | 4 | 27,118 | 61,279 | 49,704 | 118,593 |
| `cancel` | SubscriptionVault | 10 | 23,762 | 28,689 | 30,458 | 30,498 |
| `withdraw` | SubscriptionVault | 4 | 29,149 | 48,111 | 48,111 | 67,074 |
| `commitRoot` | UsageRootRegistry | 5 | 25,044 | 58,681 | 27,397 | 118,440 |

*Source: `results/gas_report.json` / `results/gas_report.md` (`sim/src/gas-report.ts`, 2026-10-16T04:46:17.519Z). Unit tests only (deviation D11).*

**Interpretation.** These are per-call distributions from tests, not costs of a typical user action. For example, `subscribeWithPermit` has only 3 samples. Receipt gas from real transactions (§9.3, §9.4) is the better estimate of what a user or keeper pays. `subscribe` costs more than a keeper charge because it creates a new subscription record (several fresh storage slots) and, the first time a plan is used, caches the plan's terms (D2).

## 9.3 Batch charging

Receipt `gasUsed` of real transactions on anvil, including 21,000 intrinsic gas and calldata, in steady state (the payee's and keeper's claimable slots are already non-zero).

| Batch size | Total gas | Gas / subscriber |
|---:|---:|---:|
| 1 | 72,525 | 72,525 |
| 5 | 181,700 | 36,340 |
| 10 | 318,183 | 31,818 |
| 25 | 727,701 | 29,108 |
| 50 | 1,410,472 | 28,209 |
| 100 | 2,776,919 | 27,769 |
| 200 | 5,513,435 | 27,567 |

A single `charge()` transaction used **71,595** gas. The very first keeper charge, which writes the keeper's claimable slot from zero (cold SSTORE), used **88,695** gas.

*Source: `results/batch_sweep.json` (`sim/src/batch-sweep.ts`, 2026-10-16T04:47:01.504Z); each row has a tx hash in the file.*

![Gas per subscriber vs batch size](../../results/fig_batch_sweep.png)

*Figure 9.1 — Receipt gas per subscriber against batch size (`results/fig_batch_sweep.png`).*

Per-subscriber gas falls **62.0 %** from batch size 1 to 200 (`results/RESULTS.md` §3). Most of the saving is reached by a batch of 25. Beyond that, the per-subscriber cost levels off at about 27.5k gas: from batch 100 to 200, total gas rises by 2,736,516 for 100 more subscribers, about 27.4k each (derived from the table). The fixed per-transaction cost (21,000 intrinsic gas plus, plausibly, the payee's and keeper's claimable writes, which are the same slots for every subscription of one plan) is shared across the batch. The remaining per-subscriber work is the token transfer (balance and allowance updates), the subscription's storage update, and the `Charged` event (the file records 2 logs per subscriber). This breakdown is the author's reading of the code and was not measured separately.

**Caveat.** All subscriptions in the sweep belong to one plan and one payee. Batches spanning many payees would save less, because each payee's claimable slot is written separately.

## 9.4 Cost model

The cost model multiplies measured receipt gas by gas prices. It uses one **measured** price and two **assumptions**:

- **Measured at run time:** Base Sepolia gas price **0.006 gwei** at block 48,178,885, plus the L1 data fee from the Base Sepolia `GasPriceOracle` (`getL1Fee`) for each transaction.
- **Assumed:** ETH/USD = **3,000**. A Base-mainnet-like L2 gas price of **0.01 gwei**, with the L1 data fee *excluded* in that column. 20 mUSDC is treated as 20 USD.

| Operation | Gas | Base Sepolia $/subscriber | % of 20 USD cycle | Assumed mainnet L2 $/subscriber | % of cycle |
|---|---:|---:|---:|---:|---:|
| charge (single tx) | 71,595 | $1.29e-3 | 0.0064 % | $2.15e-3 | 0.0107 % |
| chargeBatch(1) | 72,525 | $1.31e-3 | 0.0065 % | $2.18e-3 | 0.0109 % |
| chargeBatch(5) | 181,700 | $6.54e-4 | 0.0033 % | $1.09e-3 | 0.0055 % |
| chargeBatch(10) | 318,183 | $5.73e-4 | 0.0029 % | $9.55e-4 | 0.0048 % |
| chargeBatch(25) | 727,701 | $5.24e-4 | 0.0026 % | $8.73e-4 | 0.0044 % |
| chargeBatch(50) | 1,410,472 | $5.08e-4 | 0.0025 % | $8.46e-4 | 0.0042 % |
| chargeBatch(100) | 2,776,919 | $5.00e-4 | 0.0025 % | $8.33e-4 | 0.0042 % |
| chargeBatch(200) | 5,513,435 | $4.96e-4 | 0.0025 % | $8.27e-4 | 0.0041 % |
| subscribeWithPermit | 274,892 | $4.95e-3 | 0.0247 % | $8.25e-3 | 0.0412 % |
| subscribe | 262,640 | $4.73e-3 | 0.0236 % | $7.88e-3 | 0.0394 % |
| cancel | 51,458 | $9.26e-4 | 0.0046 % | $1.54e-3 | 0.0077 % |
| withdraw | 69,111 | $1.24e-3 | 0.0062 % | $2.07e-3 | 0.0104 % |
| createPlan | 182,973 | $3.29e-3 | 0.0165 % | $5.49e-3 | 0.0274 % |
| commitRoot | 48,397 | $8.71e-4 | 0.0044 % | $1.45e-3 | 0.0073 % |

*Source: `results/cost_model.json` (`sim/src/cost.ts`, 2026-10-16T04:47:42.181Z); table as rendered in `results/RESULTS.md` §4. The `gasSource` field of each row says where the gas figure comes from. The `charge` and `chargeBatch(n)` rows use receipt gas from `batch_sweep.json`. The other six rows (`subscribeWithPermit`, `subscribe`, `cancel`, `withdraw`, `createPlan`, `commitRoot`) use the **gas-report median execution gas + 21,000 intrinsic, without calldata gas**, so they slightly under-state a real transaction.*

**Keeper incentive.** The keeper reward is 0.25 % of price, which is **0.05 USD per charge** on a 20 USD plan (`cost_model.json`, `assumptions.keeperFee`). This is a transfer from the subscriber, not gas. Under both price scenarios above, per-subscriber gas cost is between about $5e-4 and $2.2e-3, so a keeper earns more from the fee than it spends on gas. On a low-fee L2, keeping is profitable even at batch size 1.

**What this does *not* show.** The model prices gas on **Base**, not on Ethereum Sepolia, where the contracts are actually deployed (D20), and not on Ethereum mainnet. No Ethereum L1 gas price was measured. On a chain with much higher gas prices, the 0.25 % fee may not cover a single-subscription charge. Batching (§9.3) and a higher `keeperFeeBps` (up to the 10 % cap) are the levers. Gas figures are cancun-priced from anvil. Sepolia receipts can differ (D21).

## 9.5 Keeper schedule simulation (timeliness)

**Setup.** 500 subscribers on the production-shaped plan (30-day period, 3-day grace), simulated for 12 periods on anvil with time travel (`evm_setNextBlockTimestamp`). Start times: one start per 5,184 s slot across the first period, uniformly jittered within the slot (seed 42), so due times do not line up with the keeper's tick grid. The real `Keeper` class (`keeper/src/keeper.ts`, batch size 100, page size 500) runs at four tick intervals, each on a fresh anvil. Keeper transactions are included 2 s after the tick. *Drift* = block timestamp of the charge − the `nextChargeAt` it settled. *Missed* = due at a tick but not charged in that tick.

| Tick interval | Due | Executed | Missed | Lost | Drift p50 | Drift p95 | Drift max | Drift mean | Keeper txs | Gas / charge |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 60 s | 5,500 | 5,500 | 0 | 0 | 33 s | 59 s | 61 s | 32.1 s | 5,500 | 72,534 |
| 600 s | 5,500 | 5,500 | 0 | 0 | 303 s | 570.2 s | 601 s | 307.7 s | 5,489 | 72,444 |
| 3,600 s | 5,500 | 5,500 | 0 | 0 | 1,978 s | 3,444.1 s | 3,589 s | 1,878.5 s | 5,082 | 69,096 |
| 21,600 s | 5,500 | 5,500 | 0 | 0 | 10,668.5 s | 20,336.2 s | 21,583 s | 10,633.7 s | 1,320 | 38,158 |

*Source: `results/schedule_sim.json` (`sim/src/schedule.ts`, 2026-10-16T05:18:58.053Z), fields `results[].{dueCharges, executed, missed, lost, drift, txs, gasPerCharge}`. Means are rounded to one decimal from the file's `drift.mean`.*

Why 5,500 charges and not 500 × 12 = 6,000: the simulated window ends at `horizon = T0 + 12 × period`, and the script counts the keeper charges due for each subscriber as ⌊(horizon − startedAt) / period⌋ (`sim/src/schedule.ts`, `expectedDue`). Every subscriber starts inside the first period, so each has 11 keeper charges due in the window: 500 × 11 = 5,500. The 12th period of each subscription is the one paid at subscribe time (charge #1, D7).

![CDF of charge drift per tick interval](../../results/fig_drift_cdf.png)

*Figure 9.2 — Cumulative distribution of charge drift for each tick interval (`results/fig_drift_cdf.png`).*

**Findings.**

1. **No charge was missed or lost at any tick interval.** All 5,500 due charges executed in the first tick at or after their due time.
2. **Drift is bounded by the tick interval plus inclusion delay.** The maximum drift is 61 s for a 60 s tick, 601 s for 600 s, 3,589 s for 3,600 s and 21,583 s for 21,600 s. The median is roughly half the tick, as expected for due times spread uniformly between ticks.
3. **Even a 6-hour keeper stays far inside the 3-day grace period.** Its worst drift (21,583 s ≈ 6.0 h) is about 8 % of the 259,200 s grace window. Because entitlement holds until `nextChargeAt + grace` (§5.5), subscribers keep access throughout.
4. **Slower ticks batch more.** At 21,600 s, 5,500 charges needed 1,320 transactions, and gas per charge dropped to 38,158, against 72,534 at 60 s where almost every charge was its own transaction. This is the batching effect of §9.3 appearing naturally. The trade-off is timeliness against gas.

**Threats to validity.** Anvil has no competing traffic, no gas-price spikes and instant inclusion (modelled as a fixed 2 s). All subscribers are funded, so no failure paths are exercised here; those are covered by tests (Chapter 7) and the testnet lifecycle (§9.7).

## 9.6 Keeper outage and recovery (liveness)

**Setup.** Scratch anvil (automine), 20 subscribers on the demo plan (180 s period, 60 s grace), and the **real keeper process**. The keeper was stopped with SIGTERM. Chain time was then advanced through three periods with no keeper running, and the keeper was restarted.

| Measure | Value |
|---|---|
| Shutdown | SIGTERM, exit code 0, graceful shutdown logged: true |
| Outage | 3 periods, 546 s of chain time, 0 charges during outage |
| Charges recovered after restart | **60 / 60** expected |
| Keeper transactions during recovery | 3 |
| Catch-up wall time | 1.027 s |
| Max drift during recovery | 368 s |
| Total charges expected / actual | 100 / 100 |
| Lost charges | **0** |
| Anchored schedule holds | **true** |
| Lapsed | 0 |

*Source: `results/keeper_outage.json` (`sim/src/outage.ts`, 2026-10-16T04:50:10.514Z).*

The file also records subscription #1's charge sequence. It started at chain time 1,792,126,207 and its slots are startedAt + k × 180:

| k | scheduledAt | executedAt | drift |
|---:|---:|---:|---:|
| 1 | 1,792,126,387 | 1,792,126,389 | 2 s |
| 2 | 1,792,126,567 | 1,792,126,935 | 368 s |
| 3 | 1,792,126,747 | 1,792,126,935 | 188 s |
| 4 | 1,792,126,927 | 1,792,126,935 | 8 s |

The three missed periods were all settled at the same block after restart (executedAt 1,792,126,935). Each settled its own anchored slot, one period per call. None was skipped or merged into a single larger charge, and the next billing date did not move.

The subscribers did not lapse even though the outage (546 s) was longer than the grace period (60 s). This is because lapse happens only when a charge *fails* after grace (§5.4). A funded subscription charged late succeeds. This is the intended behaviour: keeper downtime must never punish a paying subscriber.

## 9.7 Testnet lifecycle (Ethereum Sepolia)

**Planned scenario** (`sim/src/lifecycle.ts`, SPEC.md §7): subscribe with permit → 3 keeper charges → drain balance → `ChargeFailed` → PastDue → top up → recovered → cancel → entitled until paid-through → not entitled. Every step records the transaction hash, block timestamp, gas and status.

> **[PENDING: lifecycle_testnet.json — Sepolia lifecycle run]** A run is in progress in another session. When `results/lifecycle_testnet.json` exists, insert a table with one row per step (step, tx hash with Etherscan link, block timestamp, gasUsed, status after, entitled) copied from the file, plus the total number of transactions and total gas.
>
> **Known issue to state in the text:** the first `subscribeWithPermit` row in that file records the wrong status because of a script bug that is being fixed. Either use a re-run with the fixed script, or footnote that row and read the correct status from Etherscan or the next row.
>
> Where Sepolia receipt gas differs from the anvil figures in §9.2–9.3, report both and attribute the difference to Sepolia's gas pricing (D21), not to the contracts.

## 9.8 AI Power Grid snapshot

`sim/src/grid-snapshot.ts` queried AIPG's public `GET /v1/workers` and `GET /v1/status/models` at run time, using no inference credits.

| Measure | Value |
|---|---|
| Time | 2026-10-16T06:03:08.070Z |
| Workers online (entries in `/v1/workers`) | 8 |
| Text models online | `qwen38-flash-next-uncensored-125b-nvfp4`, `gpt-oss-120b`, `deepseek-v4-flash-nvfp4` |
| Other job types online | image, video, audio |
| A `qwen3` worker (our model family) online | **false** |
| Our worker identified | null (`AIPG_OUR_WORKERS` was not set) |
| `/v1/workers` response time | 1,113 ms |
| `/v1/status/models` response time | 743 ms |

*Source: `results/grid_snapshot.json` (`summary`, `workers`, `models`).*

**Implication.** At the time of the snapshot, the project's own `qwen3` worker was not serving, and no other `qwen3` worker was online. The gateway's default allowlist (`qwen3:8b,qwen3:4b,qwen3:1.7b`) therefore had nothing to route to, which is why the live benchmark (§9.9) has not been run. Mock mode is unaffected.

## 9.9 Gateway latency (live AIPG)

**Planned measurement** (`sim/src/bench.ts`, SPEC.md §7): TTFT and total latency, direct to AIPG vs through the gateway, same prompt and model (`qwen3:8b`, `max_tokens` 64), at most 30 live requests in total; gateway overhead p50/p95; entitlement-check latency, cached vs uncached (from the `X-Cashew-Entitlement-Ms` header).

> **[PENDING: gateway_bench.json + fig_ttft.png — live AIPG benchmark, not run]** Blocked until a qwen3 worker is online (§9.8). When available, insert: a table of TTFT and total latency (p50/p95) for direct vs gateway; the gateway overhead p50/p95; the entitlement-check latency cached vs uncached; and Figure 9.3 = `results/fig_ttft.png`. State the number of requests used and the date.

## 9.10 Usage epochs

> **[PENDING: epochs.json — committed usage epochs on the testnet]** When available, insert: number of committed epochs, rows and total tokens per epoch, each root with its `commitRoot` tx hash (Etherscan link), and one inclusion proof verified with `verifyRow` on-chain. Until then, the evidence that roots and proofs work is the gateway e2e test "epoch root is committed and a row's inclusion proof verifies on-chain" and `test_CommitAndVerify` / `test_HashRowMatchesStandardLeaf` (Chapter 8). `commitRoot` gas is in §9.2 and §9.4.

## 9.11 Summary of results against requirements

| Requirement | Result | Evidence |
|---|---|---|
| S1–S5, I1–I5 (safety) | All pass | §8.3, Chapter 7; `test_summary.json` |
| NF1 liveness | 60/60 recovered, 0 lost, anchored schedule intact | §9.6; `keeper_outage.json` |
| NF2 keeper incentive | Fee 0.05 USD vs gas ≤ ~$2.2e-3 per subscriber on Base pricing | §9.4; `cost_model.json` |
| NF3 scalability | −62.0 % gas per subscriber from batch 1 to 200 | §9.3; `batch_sweep.json` |
| NF4 timeliness | Max drift ≤ tick + 2 s, 0 missed, at all four tick intervals | §9.5; `schedule_sim.json` |
| NF5 gating latency | **[PENDING: gateway_bench.json]** | §9.9 |
| Testnet end-to-end | Deployed and verified; lifecycle **[PENDING: lifecycle_testnet.json]** | §8.7, §9.7 |
