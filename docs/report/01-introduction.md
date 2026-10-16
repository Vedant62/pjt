# Chapter 1 — Introduction

## 1.1 Motivation

Subscriptions (a fixed price charged every period until cancelled) are how most software, media and API access is sold. Card networks make this easy: the merchant stores a payment credential and charges it each month, and chargebacks and regulation limit abuse.

Public EVM blockchains such as Ethereum have no equivalent. A transaction moves funds only when the owner of the funds signs it. A contract can move a user's ERC-20 tokens only after the user calls `approve(spender, amount)`. The spender may then call `transferFrom` for any amount up to the allowance, at any time, for any reason.

Recurring payments on EVM are therefore usually built in one of three ways:

1. **The subscriber pays manually every period.** This is safe but defeats the purpose of a subscription, and service is interrupted whenever the user forgets.
2. **The subscriber grants a large or unlimited allowance to the merchant (or a relayer), which pulls each period.** This is convenient, but the allowance is the only limit. A compromised merchant key, a malicious relayer, or a bug in the spender contract can take the whole approved amount at once. Unlimited approvals are common in practice because they save the user repeated approval transactions. **[VERIFY: cite a documented approval-drain incident if you want a concrete example, e.g. the December 2021 BadgerDAO front-end attack that injected malicious approvals; check the details before citing.]**
3. **Streaming payments**, where a balance flows per second (Chapter 2). This changes the payment model from "price per period" to "rate per second", requires deposits or special token wrappers, and is not a drop-in replacement for a priced plan.

## 1.2 Problem statement

> Design and implement a protocol on an EVM chain that lets a provider sell a fixed-price, fixed-period subscription such that:
> (a) the subscriber authorises enrolment with **one** signature;
> (b) each later charge is triggered by an **untrusted, permissionless** third party (a keeper), so the provider need not run infrastructure and no party needs to be online at a precise time;
> (c) no keeper, provider or attacker can take more than **the plan price, at most once per elapsed period**, regardless of how large the token allowance is;
> (d) failed payments, late keepers and cancellations have well-defined, testable outcomes; and
> (e) an off-chain service can be gated on the subscription's on-chain state.

The key idea is to move the limit from the *allowance* to the *contract logic*. The subscriber grants the allowance to one audited-by-test contract, the `SubscriptionVault`, and that contract exposes no amount parameter anywhere. The amount is always the immutable plan price, and the timing is always the anchored schedule.

## 1.3 Use case: paid access to AI Power Grid

To show that the protocol works end to end, Cashew sells access to **AI Power Grid (AIPG)**, a decentralized inference network that exposes an OpenAI-compatible API at `https://api.aipowergrid.io` (SPEC.md §0). The project holds one AIPG API key and connects its own GPU worker to the grid, serving `qwen3:8b` (also `qwen3:4b` and `qwen3:1.7b`). A **Cashew Gateway** sits in front of AIPG. It lets a wallet call the API only while that wallet's on-chain subscription is entitled, meters every request, and commits a Merkle root of the usage rows on-chain once per epoch.

This use case was chosen because (i) it is a real, metered service that is naturally sold by subscription; (ii) it is already decentralized on the supply side, so payment is the missing on-chain piece; and (iii) it exercises the parts of the design that are hardest to get right: access must follow payment state promptly, including grace periods and cancellations.

## 1.4 Objectives

1. Implement the on-chain protocol: `PlanRegistry`, `SubscriptionVault`, `UsageRootRegistry`, and a test token `MockUSDC` with EIP-2612 `permit`.
2. Prove the safety properties with unit, fuzz and handler-based invariant tests, including five named "keeper cannot" properties and five named invariants (I1–I5).
3. Implement a permissionless keeper, an entitlement gateway with metering and Merkle commitments, and a dashboard.
4. Measure gas, batching efficiency, cost, keeper drift and outage recovery, and deploy and verify the contracts on a public testnet.
5. State the limitations honestly.

## 1.5 Contributions

- A **contract-bounded pull** design in which the allowance can be generous (the dashboard asks for 12 cycles) while the contract guarantees at most one `price` per elapsed period (§5).
- An **anchored schedule** (`nextChargeAt += period`) that makes late keepers harmless: charges are late, never lost, never doubled, and the billing date never drifts (§5.3, §9.5–9.6).
- **Failure as state, not revert**, which makes batching robust and gives a single, checkable entitlement rule (§5.4–5.5).
- A **gateway pattern** that maps on-chain entitlement to HTTP semantics (`402 Payment Required`) and commits verifiable usage roots (§6.2).
- A test suite that names each security claim and maps it to a test (§7), plus reproducible experiments whose outputs are machine-written JSON (§9).

## 1.6 Report organisation

Chapter 2 covers background and related work. Chapter 3 lists requirements. Chapter 4 describes the architecture, Chapter 5 the contracts and Chapter 6 the off-chain components. Chapter 7 is the security analysis, Chapter 8 implementation and testing, and Chapter 9 the evaluation. Chapter 10 covers limitations and future work, and Chapter 11 concludes. The appendices list the interfaces, deviations from the original specification, tool versions and deployed addresses.
