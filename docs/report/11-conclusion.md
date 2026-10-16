# Chapter 11 — Conclusion

Cashew shows that subscriptions on an EVM chain do not have to rely on an allowance as their only limit. By making plan terms immutable, giving the vault no amount parameter, and advancing an anchored schedule by exactly one period per successful charge, the protocol lets *anyone* trigger charges while guaranteeing that no one can take more than the plan price once per elapsed period. Treating failure as state (PastDue, Lapsed) keeps batches robust and gives one entitlement rule that an off-chain service can enforce. Here that service is a gateway that answers `402 Payment Required` when a wallet's subscription is not entitled.

The evidence for these claims is concrete and reproducible:

- 72 Foundry tests pass, including five named "keeper cannot" properties, three fuzz properties at 1,000 runs each, and five handler-based invariants over 16,384 random calls, with 100 % line coverage of the contracts (`results/test_summary.json`; PROGRESS.md).
- Batching cuts receipt gas per subscriber by 62.0 % from 1 to 200 subscriptions per transaction (`results/batch_sweep.json`; `results/RESULTS.md` §3).
- At keeper tick intervals from 60 s to 6 h, all 5,500 due charges for 500 subscribers over 12 thirty-day periods executed, with drift bounded by the tick interval and none lost (`results/schedule_sim.json`).
- After a three-period keeper outage, the restarted keeper recovered 60 of 60 missed charges with the anchored schedule intact (`results/keeper_outage.json`).
- The contracts are deployed and source-verified on Ethereum Sepolia (`docs/REPORT_NOTES.md` §7).

> **[PENDING]** Add one sentence each for the Sepolia lifecycle (`lifecycle_testnet.json`) and the live gateway benchmark (`gateway_bench.json`) once they exist.

The main open problem is trust in metering. A Merkle root binds the gateway to what it recorded, but not to what actually happened. Since billing in this design is flat-rate, that weakness affects transparency rather than payments. Removing it, along with automated payouts to the GPU workers who serve the requests, is the natural next step toward a fully decentralized pay-for-inference market.
