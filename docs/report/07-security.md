# Chapter 7 — Security Analysis and Threat Model

This chapter states what each party can and cannot do, and maps every security claim to the test that checks it. All listed tests passed in the recorded run (`results/test_summary.json`, generated 2026-10-16T04:46:15Z at commit `4439796`, dirty tree).

> **Scope of the evidence.** Tests show that the properties hold for the cases and random sequences exercised. They are not a formal proof, and the contracts have **not** been audited (Chapter 10).

## 7.1 Assets and adversaries

**Assets:** (i) subscriber token balances that sit under an allowance to the vault; (ii) payee and keeper claimable balances held by the vault; (iii) the gateway's AIPG credits; (iv) the integrity of usage records.

**Adversaries:** a malicious or buggy keeper (any EOA); a malicious provider; a malicious subscriber; a mempool front-runner; a token with re-entrant hooks; a dishonest or compromised gateway.

## 7.2 Threat model by actor

| Actor | Can | Cannot (and the test that shows it) |
|---|---|---|
| Keeper / any EOA | Trigger due charges; earn the 0.25 % fee; delay charges by not acting | Charge early (`test_KeeperCannot_ChargeEarly`, fuzz `testFuzz_ChargeBeforeDueReverts`); charge twice per period (`test_KeeperCannot_ChargeTwiceInPeriod`); charge cancelled/lapsed subscriptions (`test_KeeperCannot_ChargeCancelled`, I2); pull more than price (`test_KeeperCannot_PullMoreThanPrice`, `testFuzz_ChargedAmountEqualsPrice`, I1); take others' funds (`test_KeeperCannot_RedirectPayeeFunds`, I5) |
| Provider | Create plans; close them to new subscribers; withdraw its own revenue | Change price/period/token/payee (`test_NoTermSetters`); stop existing subscriptions by closing the plan (`test_InactivePlanDoesNotAffectExistingSubs`); pull from subscribers directly (the allowance is granted to the vault only) |
| Subscriber | Cancel any time (keeps access until paid-through); revoke the allowance; let the subscription lapse | Be charged by anyone other than the vault; get service past grace without paying (`test_PastDueThenLapse`, `test_IsEntitled_Transitions`) |
| Gateway | Gate access to its AIPG key; meter; commit roots | Move funds. It **can** mis-meter or omit rows: roots bind it to what it recorded and do not prove honesty. |
| Front-runner | Submit a subscriber's permit first | Break enrolment (`test_SubscribeWithPermit_FrontRunFallback`) |
| Re-entrant token hook | — | Re-enter the vault: `nonReentrant` on all fund-moving vault entry points, and state is updated before transfers (CEI) |

*Source: `docs/REPORT_NOTES.md` §4, cross-checked against test names in `results/test_summary.json`.*

## 7.3 The five "keeper cannot" properties

| # | Property | Test | What the test does | Why it holds |
|---|---|---|---|---|
| S1 | Charge early | `test_KeeperCannot_ChargeEarly` | Warps to `nextChargeAt − 1`; attacker calls `charge`; expects `NotDue()` | `charge` reverts if `now < nextChargeAt` |
| S2 | Charge twice in a period | `test_KeeperCannot_ChargeTwiceInPeriod` | Charges at `nextChargeAt`, immediately charges again; expects `NotDue()`; asserts the subscriber paid exactly 2 × price in total (initial + one charge) | A successful charge moves `nextChargeAt` one period forward |
| S3 | Charge a cancelled subscription | `test_KeeperCannot_ChargeCancelled` | Subscriber cancels; warps 10 periods; expects `NotChargeable(Cancelled)` | Status is checked first; Cancelled is terminal |
| S4 | Pull more than price | `test_KeeperCannot_PullMoreThanPrice` | Attacker calls `token.transferFrom(subscriber, attacker, 1,000 mUSDC)` directly; expects `ERC20InsufficientAllowance(attacker, 0, …)`. Then one vault charge moves exactly `price` | The allowance belongs to the vault; the vault has no amount parameter |
| S5 | Redirect payee funds | `test_KeeperCannot_RedirectPayeeFunds` | Attacker calls `withdraw`; expects `NothingToWithdraw()`; payee's claimable is unchanged; low-level calls to a `setPayee` selector on registry and vault fail | `withdraw` pays only `msg.sender`'s own balance; no payee setter exists |

The dashboard's `/attacks` page runs the same five attacks against a live deployment and shows the decoded errors (`NotDue()`, `NotDue()`, `NotChargeable(4)`, `ERC20InsufficientAllowance(…)`, `NothingToWithdraw()`; `docs/DEMO.md` step 6). Status 4 is `Cancelled` in the `Status` enum.

## 7.4 Invariants I1–I5

The invariant suite (`contracts/test/invariant/`) uses a **handler** contract that drives random sequences of protocol actions: `subscribe`, `charge`, `chargeBatch`, `keeperSweep`, `cancel`, `warp`, `drain`, `topUp`, `setAllowance`, `withdraw` and `attackerWithdraw`. It runs across 5 subscribers, 3 keepers, 2 payees, an attacker, and 3 plans (including an edge case with grace = period − 1). The handler keeps **independent ghost accounting** derived from token balance movements, not from the vault's own bookkeeping. The vault is therefore checked against an external reference rather than against itself.

Configuration: 256 runs × depth 64 = 16,384 handler calls, 0 reverts (handler calls wrap protocol calls in `try/catch`) (`results/test_summary.json`, `invariant`).

| Invariant | Statement (as asserted) | Status |
|---|---|---|
| `invariant_I1_noOvercharge` | For every subscriber, ghost total pulled ≤ Σ over their subscriptions of `price × (1 + ⌊(now − startedAt)/period⌋)` | ✓ |
| `invariant_I2_noChargeAfterTerminal` | No `Charged` observed after a subscription was seen Cancelled or Lapsed; its `chargeCount` never moves after that, and it never leaves the terminal state | ✓ |
| `invariant_I3_solvency` | `usdc.balanceOf(vault) == Σ claimable(account, usdc)` over all accounts | ✓ |
| `invariant_I4_anchoredSchedule` | For every subscription, `nextChargeAt == startedAt + period × chargeCount` | ✓ |
| `invariant_I5_ownFundsOnly` | For every account, ghost withdrawn ≤ ghost credited, and credited − withdrawn == `claimable`; the attacker never withdrew anything | ✓ |

*Source: `results/test_summary.json` (`invariant.predicates`), `results/RESULTS.md` §1.*

## 7.5 Fuzz properties

Each fuzz test ran 1,000 times (`results/test_summary.json`, `fuzz`).

| Test | Inputs (bounded) | Assertion |
|---|---|---|
| `testFuzz_ChargedAmountEqualsPrice` | price ∈ [1, 10¹⁸], period ∈ [1 s, 365 d], lateness ∈ [0, 3 periods] | Subscriber pays exactly `price`; the vault receives exactly `price`; keeper fee and payee credit add up |
| `testFuzz_ChargeBeforeDueReverts` | price, period, earliness ∈ [1, period], arbitrary caller | `NotDue()` |
| `testFuzz_AnchoredSchedule` | period ∈ [60 s, 30 d], k ∈ [0, 24] charges, random delays within ⅓ period | `nextChargeAt == startedAt + (k+1)·period` and `chargeCount == k+1` |

## 7.6 Other attack surfaces

- **Front-running the permit.** Handled by `try/catch` (above). A griefer who front-runs gains nothing: the allowance they set is the one the subscriber signed, granted to the vault.
- **Reentrancy.** `subscribe`, `subscribeWithPermit`, `charge`, `chargeBatch` and `withdraw` are `nonReentrant`. `_charge` and `withdraw` update storage before transferring. `cancel` makes no external call.
- **Duplicate subscriptions** (double billing for one plan) are rejected while one is live (`test_RevertWhen_DuplicateSubscription`, `test_RevertWhen_DuplicateWhilePastDue`).
- **Batch denial of service.** One failing subscriber cannot revert a batch, because failure is a state transition. *Caveat:* `chargeBatch` pre-checks balance and allowance only. A token whose `transferFrom` reverts for other reasons (blocklist, pause) would revert the whole batch (`docs/REPORT_NOTES.md` §5).
- **Keeper griefing by inaction** only delays charges. Charges are late, not lost (§9.6). Entitlement does not depend on the keeper during grace, and unfunded subscriptions lapse.
- **Gateway key leakage.** `csk_` keys are stored hashed and cannot mint new keys (D15). JWTs expire after 1 hour.
- **Credit exhaustion.** In live mode the budget is reserved before the upstream call and persisted, so neither concurrent requests nor restarts can overspend it.

## 7.7 The trusted part: metering

The gateway is trusted for *what it records*. A committed root lets anyone verify that a particular row (wallet, subId, model, token counts, request/response hashes, timestamp) is in the epoch's committed set, and the leaf can be recomputed on-chain with `hashRow`. However:

- the gateway could omit rows, or record wrong token counts, before building the tree;
- the gateway uses one shared AIPG key, so AIPG cannot attribute requests to individual wallets;
- nothing on-chain links the usage root to the payment. Billing is flat-rate per period and does not depend on metered usage.

These are design limitations, not bugs, and they are stated in Chapter 10.

## 7.8 Out of scope

Economic attacks on the settlement token, chain-level reorgs and censorship, browser-wallet compromise, and denial of service against the gateway's HTTP endpoint are out of scope for this project.
