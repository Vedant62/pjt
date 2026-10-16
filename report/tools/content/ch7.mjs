import { h2, p, ul } from "./dsl.mjs";

export default {
  title: "Conclusion and Future Work",
  blocks: [
    h2("Conclusion"),
    p("This project set out to give recurring payment a native form on a public blockchain, and to prove it against a real service rather than a toy one. The central idea was to stop asking how a contract can schedule itself and to ask instead how to make it worthwhile for anyone to call it on time, while making the contract safe against whatever that caller attempts. Cashew realises this with three mechanisms that prior designs offered separately but not together: an open trigger, a fee paid by the contract to whoever triggers, and a spending limit of one plan price per elapsed period enforced inside the contract on an anchored schedule."),
    p("The objectives were met as follows. The protocol was implemented as four contracts and deployed and source-verified on Ethereum Sepolia. Its safety was established by 72 tests, including fuzz properties and five invariants checked over 16,384 random actions, with full line coverage. The five keeper attacks were also demonstrated failing against the live deployment. Its cost was measured rather than assumed. A batched charge costs about 27,600 gas per subscriber, 0.0025 % of a 20-dollar cycle at the measured Base Sepolia gas price and about one hundredth of the keeper's reward, so the keeper market funds itself. Its timeliness and liveness were shown at scale: 22,000 simulated renewals across four keeper intervals with none missed, drift bounded by the tick interval, and complete recovery after a three-period keeper outage. On the service side, the gateway sold live qwen3 inference from the team's own GPU worker on AI Power Grid only to entitled wallets, returned HTTP 402 to others, and committed its usage to the chain in two epochs whose rows verify on-chain and fail verification when tampered with."),
    p("Several results were not obvious at the outset. First, treating payment failure as a state transition rather than a revert matters as much as the cap itself: it lets one batch serve many subscribers without one bad wallet blocking the rest, and it ensures keepers are never paid for failed attempts. Second, the keeper's tick interval is a cost–latency dial rather than a safety parameter. A six-hour keeper is up to six hours late but costs half as much gas per charge, and the grace period, not the keeper, decides when access ends. Third, the real environment differed from the local one in ways only deployment revealed. Sepolia's state-creation repricing made contract creation about five times more expensive than local simulation predicted, and the live model spent its whole token budget on reasoning, which broke a naive time-to-first-token measurement. Both were caught because results were measured, and both are reported rather than smoothed over."),
    h2("Limitations"),
    p("The project has clear boundaries, and it is important not to overstate what has been shown."),
    ul(
      "**The gateway is a trusted metering party.** A usage root proves that a row is part of what the gateway recorded. It does not prove the record is complete or that the gateway is honest.",
      "**A single AI Power Grid key** is shared behind the gateway. Per-wallet limits are enforced by the gateway, not by AIPG.",
      "**Revenue is not yet distributed to individual GPU workers.** The provider's revenue goes to one payee address. Automated, proof-based payouts to workers remain future work.",
      "**Testnet only, with a mock token.** No real USDC was used and the contracts have not been audited.",
      "**Linear due-scan.** `dueSubscriptions` scans subscription ids in pages, including terminal ones. That suits the evaluated scale, but a production deployment would want an indexed due-queue.",
      "**Non-standard tokens.** The vault pre-checks balance and allowance. A token whose transfers revert for other reasons, such as blocklists or pauses, would revert a whole batch, and fee-on-transfer tokens are not supported.",
      "**Small live latency sample.** Live latency was limited to 30 requests to protect the shared credit, so time-to-first-token statistics rest on three pairs. They show grid variance dominating, but they cannot resolve the gateway's own overhead.",
    ),
    h2("Future Work"),
    ul(
      "**Worker payouts from usage roots.** Allocate each period's revenue to worker addresses pro rata to the tokens they served, claimable with a Merkle proof against the same epoch root. This closes the loop between subscribers and GPU owners.",
      "**Reducing trust in metering.** Let independent keepers or validators attest usage, for example by co-signing epoch roots or sampling rows against grid job records, so the gateway is no longer the only witness.",
      "**Gasless enrolment.** Use an ERC-4337 smart account with a paymaster so that a subscriber holding only stablecoins can enrol without any native token.",
      "**Production hardening.** An indexed due-queue, support for additional settlement tokens, an external security audit, and deployment on Base, where the cost model already applies.",
      "**Standardisation.** Package the vault's interface (subscribe, charge, chargeBatch, cancel, isEntitled) as a reusable standard, so that other services can sell access with the same safety guarantees.",
    ),
    p("In short, Cashew shows that a subscription on a public chain can be automatic, capped and revocable without trusting the party that triggers it. A real, independently operated compute network can then be sold through it, with what was consumed committed on-chain where anyone can check it."),
  ],
};
