# Cashew — Results

Generated 2026-10-16T05:19:12.564Z at commit `4439796` (uncommitted changes present) by `sim/src/summarize.ts`.

Every number below is copied from a JSON file in this directory that a script wrote while running. Anything that could not be measured is reported as **null** with the reason.

## 1. Contract test suite

| Kind | Total | Passed | Failed |
|---|---:|---:|---:|
| Unit | 68 | 68 | 0 |
| Fuzz (1000 runs each) | 3 | 3 | 0 |
| Invariant predicates (256 runs × depth 64 = 16,384 calls) | 5 | 5 | 0 |

Invariants: `invariant_I1_noOvercharge` ✓, `invariant_I2_noChargeAfterTerminal` ✓, `invariant_I3_solvency` ✓, `invariant_I4_anchoredSchedule` ✓, `invariant_I5_ownFundsOnly` ✓.

"Keeper cannot" properties: `test_KeeperCannot_ChargeCancelled` ✓, `test_KeeperCannot_ChargeEarly` ✓, `test_KeeperCannot_ChargeTwiceInPeriod` ✓, `test_KeeperCannot_PullMoreThanPrice` ✓, `test_KeeperCannot_RedirectPayeeFunds` ✓.

Line coverage of `src/` (`forge coverage`, recorded in PROGRESS.md): 100 %.

_Source: `sim/src/test-summary.ts` at 2026-10-16T04:46:15.931Z, commit `4439796` (dirty tree)._

## 2. Gas per operation

Execution gas per call as measured by Foundry across unit tests (includes reverting calls in tests). Excludes 21,000 intrinsic + calldata gas. chargeBatch varies with batch size; see batch_sweep.json.

| Operation | Min | Avg | Median | Max |
|---|---:|---:|---:|---:|
| `createPlan` | 23,226 | 147,209 | 161,973 | 161,973 |
| `subscribeWithPermit` | 213,051 | 252,454 | 253,892 | 290,419 |
| `subscribe` | 36,446 | 204,235 | 241,640 | 241,640 |
| `charge` | 29,057 | 61,712 | 46,360 | 94,772 |
| `chargeBatch` | 27,118 | 61,279 | 49,704 | 118,593 |
| `cancel` | 23,762 | 28,689 | 30,458 | 30,498 |
| `withdraw` | 29,149 | 48,111 | 48,111 | 67,074 |
| `commitRoot` | 25,044 | 58,681 | 27,397 | 118,440 |

_Source: `sim/src/gas-report.ts` at 2026-10-16T04:46:17.519Z, commit `4439796` (dirty tree)._

## 3. Batch charging (receipt gas)

Receipt gasUsed of real transactions (includes 21,000 intrinsic + calldata). Steady state: payee and keeper claimable slots already non-zero. A single `charge()` transaction used 71,595 gas (the very first keeper charge, with a cold fee slot, used 88,695).

| Batch size | Total gas | Gas / subscriber |
|---:|---:|---:|
| 1 | 72,525 | 72,525 |
| 5 | 181,700 | 36,340 |
| 10 | 318,183 | 31,818 |
| 25 | 727,701 | 29,108 |
| 50 | 1,410,472 | 28,209 |
| 100 | 2,776,919 | 27,769 |
| 200 | 5,513,435 | 27,567 |

Per-subscriber gas falls 62.0 % from batch size 1 to 200.

![fig_batch_sweep.png](fig_batch_sweep.png)

_Source: `sim/src/batch-sweep.ts` at 2026-10-16T04:47:01.504Z, commit `4439796` (dirty tree)._

## 4. Cost model

Measured at run time: Base Sepolia gas price **0.006 gwei** (block 48178885); L1 data fee from the Base Sepolia GasPriceOracle.

Assumptions (not measured): ETH/USD = **3000**; Base-mainnet-like L2 gas price = **0.01 gwei** (L1 data fee excluded in that column); 20 mUSDC ≙ 20 USD.

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

The keeper reward is 0.25 % of price (0.05 USD per charge). This is a transfer from the subscriber, not gas, so a keeper earns money whenever the per-subscriber gas cost is below 0.05 USD.

_Source: `sim/src/cost.ts` at 2026-10-16T04:47:42.181Z, commit `4439796` (dirty tree)._

## 5. Keeper schedule simulation

500 subscribers, 12 periods of 30 days (grace 3 days). Start times: one start per 5184.0 s slot across the first period, uniformly jittered within the slot (seed 42). Keeper txs are included 2 s after the tick.

| Tick interval | Due | Executed | Missed | Lost | Drift p50 | Drift p95 | Drift max | Keeper txs | Gas / charge |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 60 s | 5,500 | 5,500 | 0 | 0 | 33 s | 59 s | 61 s | 5,500 | 72,534 |
| 600 s | 5,500 | 5,500 | 0 | 0 | 303 s | 570.2 s | 601 s | 5,489 | 72,444 |
| 3,600 s | 5,500 | 5,500 | 0 | 0 | 1,978 s | 3,444.1 s | 3,589 s | 5,082 | 69,096 |
| 21,600 s | 5,500 | 5,500 | 0 | 0 | 10,668.5 s | 20,336.2 s | 21,583 s | 1,320 | 38,158 |

drift = block timestamp of the charge − the nextChargeAt it settled. 'ticks' lists only ticks where something was due; ticksEmpty did no work. missed = due at a tick but not charged in that tick.

![fig_drift_cdf.png](fig_drift_cdf.png)

_Source: `sim/src/schedule.ts` at 2026-10-16T05:18:58.053Z, commit `4439796` (dirty tree)._

## 6. Keeper outage and restart

The real keeper process was stopped with SIGTERM (exit code 0, logged graceful shutdown: true). Chain time then advanced 546 s (3 periods; grace is 60 s) with 0 charges. After restart it recovered **60/60** missed charges in 3 txs (1.0 s wall time). Lost charges: **0**. Anchored schedule holds: **true**. Lapsed: 0.

_Source: `sim/src/outage.ts` at 2026-10-16T04:50:10.514Z, commit `4439796` (dirty tree)._

## 7. Base Sepolia lifecycle

**null** — `results/lifecycle_testnet.json` not present. Not run yet: needs the Base Sepolia deployment (`pnpm deploy:testnet`) and two funded testnet keys (`pnpm results:testnet`).
## 8. AI Power Grid snapshot

**null** — `results/grid_snapshot.json` not present. Not run yet: `pnpm results:testnet` (uses no inference credits).
## 9. Gateway latency (live AIPG)

**null** — `results/gateway_bench.json` not present. Not run yet: needs AIPG_MODE=live, an AIPG API key and an entitled gateway key (`pnpm results:testnet`, ≤ 30 live requests).
## 10. Usage epochs

**null** — `results/epochs.json` not present. Not run yet: produced from the testnet gateway after epochs commit (`pnpm results:testnet`).
## Assumptions and caveats

- Local experiments run on anvil (chainId 31337), with time travel where stated. Gas is EVM gas, which is identical on Base. Fees are not.
- The Foundry gas report measures execution gas only. Receipt gas (sections 3, 5) includes intrinsic and calldata gas.
- Cost-model rows marked "assumed" depend on ETH/USD and gas-price assumptions stated in section 4.
- The gateway is a trusted metering party: an epoch root proves only what the gateway recorded.
