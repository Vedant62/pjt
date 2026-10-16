# Chapter 5 — Smart Contract Design

All contracts are written in Solidity 0.8.24 (optimizer 200 runs, EVM version `cancun`) on OpenZeppelin Contracts 5.1.0 (Appendix C). The full interfaces are in Appendix A. This chapter explains the rules and why they were chosen.

## 5.1 `PlanRegistry`: immutable terms

```solidity
struct Plan {
    address provider;     // msg.sender at creation
    address payee;        // receives revenue; immutable
    address token;        // ERC-20 settlement token; immutable
    uint96  price;        // per-period price in token units; immutable
    uint32  period;       // seconds; immutable; > 0
    uint32  gracePeriod;  // seconds; immutable; MUST be < period
    bool    active;       // provider can close to NEW subscriptions only
    string  metadataURI;  // name/description/features
}
```

`createPlan` rejects a zero token or payee address (`ZeroAddress`), a zero price (`ZeroPrice`, deviation D5), a zero period (`ZeroPeriod`), and `gracePeriod ≥ period` (`GraceNotLessThanPeriod`). The only mutable field is `active`, changed by `setPlanActive` and only by the plan's provider (`NotProvider`). **There is no setter for price, period, grace, token or payee.** `test_NoTermSetters` checks this by calling would-be setter selectors and asserting that the calls fail.

Two consequences matter for security:

1. A subscriber who enrols agrees to fixed terms. The provider cannot raise the price, shorten the period or redirect revenue afterwards.
2. Closing a plan affects only *new* subscriptions (`test_InactivePlanDoesNotAffectExistingSubs`), so a provider cannot use `active` to trap or cut off existing subscribers.

`getPlanTerms` (deviation D1) returns the economic terms without the metadata string, which is cheaper for the vault to read. The vault caches the terms on first use (D2). This is safe because they are immutable, and it saves an external call on every charge. `active` is still read live at subscribe time.

## 5.2 Subscribing

```solidity
function subscribeWithPermit(uint256 planId, uint256 permitValue, uint256 deadline,
                             uint8 v, bytes32 r, bytes32 s) external nonReentrant returns (uint256 subId);
function subscribe(uint256 planId) external nonReentrant returns (uint256 subId);
```

`subscribeWithPermit` first calls `token.permit(msg.sender, vault, permitValue, deadline, v, r, s)` inside `try/catch`. If a front-runner has already submitted the same permit, the call fails, but the allowance is already set, so enrolment continues (`test_SubscribeWithPermit_FrontRunFallback`). If the permit is invalid *and* there is no allowance, the subsequent `transferFrom` reverts (`test_RevertWhen_PermitInvalidAndNoAllowance`).

`_subscribe` then:

1. requires the plan to be active (`PlanInactive`);
2. rejects a second live subscription for the same (wallet, plan): if the latest one is Active or PastDue, it reverts `AlreadySubscribed(subId)`;
3. creates the subscription with `startedAt = now`, `nextChargeAt = now + period`, `chargeCount = 1` and `status = Active`;
4. pulls the **first period immediately** from the subscriber and credits the full price to the payee (no keeper fee on the first payment);
5. emits `Subscribed`.

The initial payment counts as charge #1 (deviation D7). This makes the anchored-schedule invariant I4 (`nextChargeAt = startedAt + period × chargeCount`) hold from the moment of enrolment.

**Allowance sizing.** The dashboard asks the subscriber to permit `price × 12` (12 cycles). This is a convenience: the subscriber does not need to re-approve every period. It is *not* a limit the vault relies on. The vault still pulls at most `price` per elapsed period, and the allowance is granted only to the vault, never to the keeper, provider or gateway.

## 5.3 Charging and the anchored schedule

```solidity
function charge(uint256 subId) external nonReentrant;                       // anyone
function chargeBatch(uint256[] calldata subIds) external nonReentrant
         returns (uint256 ok, uint256 failed, uint256 skipped);             // anyone, ≤ 200 ids
```

`charge` checks status first, then time:

- If the status is not Active or PastDue → revert `NotChargeable(status)`. Checking status first (D8) means a cancelled subscription reports `NotChargeable(Cancelled)` even before its due time, which is more informative.
- If `block.timestamp < nextChargeAt` → revert `NotDue()`. This one check covers both "charge early" and "charge twice in the same period", because a successful charge moves `nextChargeAt` one period forward.

**There is no amount parameter anywhere in the vault.** The amount is always the cached `plan.price`.

On a successful charge the vault applies the effects *before* the token transfer (Checks-Effects-Interactions):

```
next            = nextChargeAt + period        // anchored: not now + period
nextChargeAt    = next
chargeCount    += 1
status          = Active;  pastDueSince = 0
fee             = price × keeperFeeBps / 10_000
transferFrom(subscriber → vault, price)
claimable[payee][token]      += price − fee
claimable[msg.sender][token] += fee            // only if fee ≠ 0
emit Charged(subId, planId, price, fee, msg.sender, next)
```

**Why anchored?** With `nextChargeAt = now + period`, a keeper that arrives late would push every future billing date later, and the subscriber would receive more service than they paid for. With `nextChargeAt += period`:

- a late charge settles exactly the period that was due, and the billing date never drifts (`test_LateChargeWithFundsSucceeds`);
- after an outage of k periods, k further calls are each immediately due, and each settles one period (`test_CatchUpAfterOutage`; experiment in §9.6). No single call can take `k × price`;
- I4 holds at all times.

The bound on total charges is invariant I1: a subscriber can have been charged at most `price × (1 + ⌊(now − startedAt)/period⌋)` per subscription.

**Batching.** `chargeBatch` loops over up to `MAX_BATCH = 200` ids (`BatchTooLarge` above that). Ids that are not chargeable or not due are *skipped* and counted, not reverted. Each remaining id runs the same internal `_charge`, which returns `Charged`, `Failed` or `Lapsed`. A single bad subscriber therefore cannot make a keeper's batch fail.

## 5.4 Failure as state: PastDue and Lapsed

Before pulling, `_charge` checks the subscriber's balance and then allowance against `price`. If either is short:

- If `now ≥ nextChargeAt + gracePeriod` → status `Lapsed`, emit `SubscriptionLapsed`, return. No revert, no fee.
- Otherwise → status `PastDue` (recording `pastDueSince = nextChargeAt` the first time), emit `ChargeFailed(subId, reason)` with reason 1 = balance or 2 = allowance, return. No revert, no fee.

A PastDue subscription that is topped up within grace recovers to Active on the next charge, and `nextChargeAt` still advances by exactly one period from the original due time (`test_RecoverFromPastDue`). Because `gracePeriod < period` is enforced at plan creation, a subscription that is never funded lapses at the first charge attempt after grace, instead of accumulating debt across periods (`test_PastDueThenLapse`, `test_LapseAfterGrace`).

Keepers earn the fee **only on success**. They have no incentive to call `charge` on failing subscriptions, and failures cost the subscriber nothing.

Note that a *late* charge on a funded subscription succeeds even after grace has passed (`test_LateChargeWithFundsSucceeds`). Lapse happens only when collection fails after grace. Keeper lateness never punishes a paying subscriber.

## 5.5 The entitlement rule

```solidity
function isEntitled(uint256 subId) public view returns (bool) {
    if (status == Active || status == PastDue) return now < nextChargeAt + gracePeriod;
    if (status == Cancelled)                    return now < nextChargeAt;   // paid-through
    return false;                                                            // None, Lapsed
}
```

Properties:

- **A late keeper does not cut access during grace.** If the period has ended but no keeper has charged yet, the subscriber stays entitled until `nextChargeAt + grace`.
- **A failed payment cuts access once grace ends**, even if no keeper calls again, because the rule is evaluated against the current time.
- **Cancellation is paid-through.** A cancelled subscription stays entitled until `nextChargeAt` (the end of the last paid period) and can never be charged again (`test_Cancel`, `test_IsEntitled_Transitions`). A subscription cancelled while PastDue is not entitled past its unpaid due time (`test_CancelPastDueNotEntitled`).

`entitledSubOf(wallet, planId)` returns the wallet's latest subscription id if it is entitled, otherwise 0. `latestSubOf` (D3) returns the latest id in any status, so the gateway can report *why* access is refused.

## 5.6 Cancel and withdraw

`cancel(subId)` is subscriber-only (`NotSubscriber`). On a subscription that is not Active or PastDue it reverts `NotChargeable(status)` (D6). It sets `Cancelled` and emits `Cancelled(subId, paidThrough = nextChargeAt)`.

`withdraw(token)` pays `msg.sender` its own `claimable[msg.sender][token]`, zeroing the balance before the transfer, and reverts `NothingToWithdraw` if zero. Payees and keepers withdraw the same way. There is no admin, no owner and no function that moves another account's balance. This is the basis for invariant I5 and property S5.

## 5.7 Keeper fee

`keeperFeeBps` is an `immutable` set in the constructor, capped at `MAX_KEEPER_FEE_BPS = 1,000` (10 %, `FeeTooHigh`). The deployment uses **25 bps (0.25 %)** (`Deploy.s.sol`; `docs/REPORT_NOTES.md` §7). On the 20 mUSDC demo plan this is 0.05 mUSDC per successful charge (`results/cost_model.json`, `assumptions.keeperFee`). The fee is taken from the price, so the subscriber never pays more than `price`. The payee receives `price − fee`. A zero fee is supported (`test_ChargeWithZeroFee`).

## 5.8 Solvency

Every token that enters the vault does so through `_subscribe` or `_charge`, and each of those credits exactly the amount pulled to `claimable` (payee, or payee + keeper). Every token that leaves does so through `withdraw`, which debits exactly the amount sent. Hence:

```
token.balanceOf(vault) == Σ_accounts claimable[account][token]
```

This is invariant I3. It holds for tokens that arrive through the protocol. Tokens sent directly to the vault by mistake are not credited to anyone and are stuck. This is harmless to the invariant's purpose but is listed as a limitation (`docs/REPORT_NOTES.md` §5).

## 5.9 Keeper discovery

`dueSubscriptions(cursor, limit)` scans ids `[cursor, cursor + limit)` and returns those that are Active or PastDue and due, plus the next cursor (0 at the end). It is a `view`, called off-chain by the keeper, so it costs no gas. It scans linearly, including terminal subscriptions. This is acceptable for a demonstration, but a production system would need an off-chain index or an on-chain due-queue (Chapter 10).

## 5.10 `UsageRootRegistry`

`UsageRootRegistry` is `Ownable`. The owner allow-lists committers (`setCommitter`). In the deployment, the gateway's address is the committer (`docs/REPORT_NOTES.md` §7). A committer posts at most one root per (planId, epoch) (`RootAlreadyCommitted`), and the root must be non-zero (`ZeroRoot`). Each record stores the root, row count, total tokens, commit time, committer and a URI.

The leaf schema matches `@openzeppelin/merkle-tree`'s `StandardMerkleTree`:

```
["uint64 epoch","address wallet","uint256 subId","string model","uint32 promptTokens",
 "uint32 completionTokens","bytes32 requestHash","bytes32 responseHash","uint64 timestamp"]
leaf = keccak256(bytes.concat(keccak256(abi.encode(row...))))
```

`verifyRow(planId, epoch, proof, leaf)` returns false for an uncommitted epoch (`test_VerifyUncommittedEpochFalse`) and otherwise uses OpenZeppelin `MerkleProof.verifyCalldata`. `hashRow` (D4) computes the leaf on-chain, so the dashboard or anyone else can build the leaf from the row values without trusting the gateway's hashing.

## 5.11 `MockUSDC`

`MockUSDC` is `ERC20("Mock USD Coin", "mUSDC") + ERC20Permit`, with `decimals() = 6` and an open `mint` capped at 1,000 mUSDC per call (`MintCapExceeded`). It exists only so that the testnet demonstration involves no real money. The vault works with any standard ERC-20. EIP-2612 support is needed only for the one-signature path.
