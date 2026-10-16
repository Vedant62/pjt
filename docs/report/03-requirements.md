# Chapter 3 — Requirements and Design Goals

The requirements below are taken from the project specification (`SPEC.md`). Each is mapped to where it is implemented and how it is checked. "Test" names refer to Foundry tests in `contracts/test/` (results in `results/test_summary.json`) or to the gateway end-to-end tests in `gateway/test/e2e.test.ts`.

## 3.1 Actors

| Actor | Description |
|---|---|
| Provider | Publishes plans and receives revenue (via a `payee` address). |
| Subscriber | Enrols in a plan, pays each period, may cancel. |
| Keeper | Any account that triggers due charges. Untrusted and permissionless. |
| Gateway operator | Runs the Cashew Gateway: holds the AIPG API key, meters usage, commits roots. |
| Verifier | Anyone who checks a usage row against an on-chain root. |
| Attacker | Any account trying to take funds or service it is not owed. |

## 3.2 Functional requirements

| ID | Requirement | Implemented in | Evidence |
|---|---|---|---|
| FR1 | A provider can create a plan with token, price, period, grace (< period), payee and metadata. Terms are immutable. | `PlanRegistry.createPlan` | `test_CreatePlan`, `test_NoTermSetters`, `test_RevertWhen_Grace*` |
| FR2 | A provider can close a plan to *new* subscribers without affecting existing ones. | `setPlanActive` | `test_SetPlanActive`, `test_InactivePlanDoesNotAffectExistingSubs` |
| FR3 | A subscriber enrols with one EIP-2612 signature plus one transaction. The first period is paid immediately. | `subscribeWithPermit` | `test_SubscribeWithPermit`, gateway e2e "subscribe with one EIP-2612 permit" |
| FR4 | Enrolment tolerates a front-run permit. | `try/catch` around `permit` | `test_SubscribeWithPermit_FrontRunFallback` |
| FR5 | At most one live (Active/PastDue) subscription per wallet per plan. | `_subscribe` | `test_RevertWhen_DuplicateSubscription`, `test_RevertWhen_DuplicateWhilePastDue` |
| FR6 | Anyone can charge a due subscription. The amount is always `price`, at most once per elapsed period. | `charge`, `chargeBatch` | `test_Charge`, five `test_KeeperCannot_*`, fuzz tests, I1 |
| FR7 | Insufficient balance or allowance moves the subscription to PastDue, and after grace to Lapsed, without reverting. | `_charge` | `test_ChargeFailed_Balance`, `test_ChargeFailed_Allowance`, `test_PastDueThenLapse`, `test_LapseAfterGrace`, `test_RecoverFromPastDue` |
| FR8 | Batch charging never reverts on one bad id; max 200 ids. | `chargeBatch` | `test_ChargeBatch`, `test_ChargeBatch_LapseCountsAsFailed`, `test_RevertWhen_BatchTooLarge` |
| FR9 | The subscriber can cancel and stays entitled until paid-through. | `cancel`, `isEntitled` | `test_Cancel`, `test_IsEntitled_Transitions`, gateway e2e "cancelled subscription is entitled until paid-through, then 402" |
| FR10 | Payees and keepers withdraw only their own balance. | `withdraw` | `test_Withdraw`, `test_RevertWhen_WithdrawZero`, `test_KeeperCannot_RedirectPayeeFunds`, I5 |
| FR11 | Keepers can discover due subscriptions. | `dueSubscriptions` | `test_DueSubscriptions`, `test_DueSubscriptions_IncludesPastDue` |
| FR12 | The gateway serves `/v1/chat/completions` only to entitled wallets, otherwise `402` with the on-chain status. | `gateway/src/app.ts` | gateway e2e tests 2, 4, 5, 9 |
| FR13 | The gateway meters each request and commits one Merkle root per (plan, epoch). Anyone can verify a row on-chain. | `gateway/src/epochs.ts`, `UsageRootRegistry` | `test_CommitAndVerify`, `test_HashRowMatchesStandardLeaf`, gateway e2e "epoch root is committed and a row's inclusion proof verifies on-chain" |
| FR14 | A dashboard shows plans, subscription state, live events, an attack panel and a proof verifier. | `dashboard/` | Manual walk-through (PROGRESS.md, Phase 4). Screenshots **[PENDING: docs/screenshots/]** |

## 3.3 Safety requirements (the "keeper cannot" properties)

A keeper (or any account) must not be able to:

| ID | Property | Named test |
|---|---|---|
| S1 | Charge before the due time | `test_KeeperCannot_ChargeEarly` |
| S2 | Charge twice in one period | `test_KeeperCannot_ChargeTwiceInPeriod` |
| S3 | Charge a cancelled subscription | `test_KeeperCannot_ChargeCancelled` |
| S4 | Pull more than the plan price | `test_KeeperCannot_PullMoreThanPrice` |
| S5 | Redirect the payee's funds | `test_KeeperCannot_RedirectPayeeFunds` |

And these invariants must hold across arbitrary call sequences:

| ID | Invariant |
|---|---|
| I1 | No overcharge: total pulled from a subscriber ≤ Σ over their subscriptions of `price × (1 + ⌊(now − startedAt)/period⌋)` |
| I2 | No successful charge after Cancelled or Lapsed |
| I3 | Solvency: vault token balance = Σ claimable |
| I4 | Anchored schedule: `nextChargeAt = startedAt + period × chargeCount` |
| I5 | Own funds only: no account withdraws more than it was credited |

## 3.4 Non-functional requirements

| ID | Requirement | How addressed |
|---|---|---|
| NF1 | **Liveness without trust.** If keepers are absent, charges are late, not lost, and never doubled. | Anchored schedule; `results/keeper_outage.json` (§9.6) |
| NF2 | **Keeper incentive.** Keeping should be profitable at realistic gas prices. | 0.25 % fee vs. gas cost, `results/cost_model.json` (§9.4) |
| NF3 | **Scalability.** Batching should reduce per-subscriber gas. | `results/batch_sweep.json` (§9.3) |
| NF4 | **Timeliness.** Charge drift should be bounded by the keeper tick interval. | `results/schedule_sim.json` (§9.5) |
| NF5 | **Responsiveness of gating.** Access should follow on-chain state within seconds. | 15 s entitlement cache (§6.2). Latency **[PENDING: gateway_bench.json]** |
| NF6 | **Credit safety.** Protect the limited AIPG credit balance. | Mock mode by default; live mode caps `max_tokens` at 256, 10 req/min per wallet, persisted global budget (default 150) (§6.2) |
| NF7 | **Reproducibility and honesty.** Every reported number is machine-written by a script that ran; unmeasured values are `null`. | `results/*.json` include script name, timestamp and commit; `results/RESULTS.md` |
| NF8 | **No custody off-chain.** Off-chain services never hold user funds. | Architecture (§4); the gateway and keeper have no fund-moving powers beyond `charge` |

## 3.5 Design goals and non-goals

**Goals:** minimal trusted surface on-chain (no admin, no upgradeability, no setters for economic terms); one signature to enrol; failure handled as state; boring, widely used libraries (OpenZeppelin v5, Foundry, viem).

**Non-goals (for this capstone):** real money or mainnet deployment; trustless metering of off-chain service usage; automated payouts to AIPG workers; support for fee-on-transfer or rebasing tokens; gas sponsorship for subscribers without ETH. These are discussed in Chapter 10.
