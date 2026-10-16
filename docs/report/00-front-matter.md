# Cashew: Keeper-Triggered, Contract-Bounded Recurring Payments on EVM, Demonstrated on Paid Access to AI Power Grid

> **[STUDENT TO SUPPLY]** Full name(s), roll number(s), department, college/university, degree (B.Tech, branch), academic year, project guide's name and designation, external examiner (if required), and submission month/year.

| | |
|---|---|
| Submitted by | **[STUDENT TO SUPPLY: name, roll no.]** |
| Guide | **[STUDENT TO SUPPLY: name, designation]** |
| Department / Institution | **[STUDENT TO SUPPLY]** |
| Degree | Bachelor of Technology, **[branch]** |
| Academic year | **[STUDENT TO SUPPLY]** |

**Certificate, declaration and acknowledgements.** Use your institution's template. **[STUDENT TO SUPPLY]**

---

## Abstract

Recurring payments are the default way digital services are sold, but EVM blockchains have no native "pull" payment. The common workaround is to have the subscriber grant a large (often unlimited) ERC-20 allowance to a merchant or a relayer. That allowance then becomes the only limit on what can be taken. Anyone who controls the spender can drain the approved amount at any time.

**Cashew** turns this around: *the contract, not the allowance, enforces the limit*. A provider publishes a plan whose price, period, grace period, token and payee are immutable. A subscriber enrols with **one** EIP-712 (EIP-2612 `permit`) signature and one transaction. After that, **any** account, an untrusted and permissionless *keeper*, may trigger a charge when it falls due. The vault has no amount parameter, charges at most `price` at most once per elapsed period on an *anchored* schedule, and pays the caller a 0.25 % fee only on success. Failed payments are state transitions (Active → PastDue → Lapsed), not reverts, so batches never fail on one bad subscriber. Access is derived from on-chain state by a single entitlement rule.

The protocol is demonstrated by selling access to **AI Power Grid (AIPG)**, a decentralized inference network with an OpenAI-compatible API. A **Cashew Gateway** authenticates wallets with Sign-In With Ethereum (EIP-4361), serves requests only while the wallet's subscription is entitled (otherwise HTTP 402), meters every request, and commits one Merkle root of usage rows per epoch to an on-chain registry. A Next.js dashboard exposes the provider, subscriber, attacker and verifier views.

The four Solidity contracts are covered by 72 Foundry tests (68 unit, 3 fuzz at 1,000 runs each, and one handler-based invariant campaign checking five invariants over 256 runs × depth 64) with 100 % line coverage of `src/`. Five named tests show that a keeper cannot charge early, charge twice in a period, charge a cancelled subscription, pull more than the price, or redirect the payee's funds. On a local chain, batching reduces receipt gas per subscriber from 72,525 (batch of 1) to 27,567 (batch of 200), a 62.0 % reduction. In a simulation of 500 subscribers over 12 thirty-day periods, keepers ticking every 60 s to every 6 h executed all 5,500 due charges with zero lost, and a keeper stopped for three periods recovered all 60 missed charges after restart with the anchored schedule intact. The contracts are deployed and source-verified on Ethereum Sepolia. Live-network latency of the gateway and the full testnet lifecycle run are reported separately (see Chapter 9). The report states the main limitation plainly: the gateway is a trusted metering party, and a usage root proves only what the gateway recorded.

*Sources for every number in this abstract: `results/test_summary.json`, `results/RESULTS.md` §1 and §3, `results/batch_sweep.json`, `results/schedule_sim.json`, `results/keeper_outage.json`, `PROGRESS.md` (coverage), `docs/REPORT_NOTES.md` §7 (deployment).*

> **[PENDING: lifecycle_testnet.json, gateway_bench.json]** When the Sepolia lifecycle run and the live-AIPG benchmark exist, add one sentence each to the abstract (e.g. "On Ethereum Sepolia, the full lifecycle … completed in N transactions" and "the gateway added a median of X ms to time-to-first-token"), copying numbers only from those files.

**Keywords:** recurring payments, ERC-20 allowance, EIP-2612 permit, EIP-712, keepers, smart contracts, Merkle commitments, decentralized AI inference, HTTP 402.

## List of abbreviations

| Abbreviation | Meaning |
|---|---|
| AIPG | AI Power Grid |
| CEI | Checks-Effects-Interactions (a Solidity coding pattern) |
| EIP / ERC | Ethereum Improvement Proposal / Ethereum Request for Comments |
| EOA | Externally owned account |
| JWT | JSON Web Token |
| mUSDC | Mock USD Coin, the project's 6-decimal test token |
| SIWE | Sign-In With Ethereum (EIP-4361) |
| SSE | Server-Sent Events |
| TTFT | Time to first token |
| bps | Basis points (1 bps = 0.01 %) |
