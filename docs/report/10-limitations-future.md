# Chapter 10 — Limitations and Future Work

## 10.1 Limitations (stated honestly)

1. **The gateway is a trusted metering party.** A usage root proves that a row is included in what the gateway recorded. It does not prove that the record is complete or correct. A dishonest gateway could omit rows or misstate token counts. Billing is flat-rate per period and does not depend on metered usage, so mis-metering affects transparency, not what subscribers pay.
2. **One AIPG API key is shared behind the gateway.** AIPG sees one customer. Per-wallet limits (10 req/min in live mode, model allowlist, `max_tokens` cap) are enforced by the gateway, not by AIPG.
3. **Worker payouts are not automated.** Revenue goes to one payee. Distributing it to the AIPG workers that served the requests is a stretch goal (§10.2).
4. **Mock token, testnet only.** Settlement uses `MockUSDC` (open mint), not real USDC, and nothing is deployed on a mainnet. Fee-on-transfer and rebasing tokens are not supported.
5. **No audit.** The contracts are tested (72 tests, 100 % line coverage; Chapter 8) but have not been reviewed by an independent auditor, and the testing is not formal verification.
6. **Linear keeper discovery.** `dueSubscriptions` scans ids linearly, including terminal ones. That is fine at demo scale, but a large deployment needs an off-chain index (events) or an on-chain due-queue.
7. **Batch revert on unusual tokens.** `chargeBatch` pre-checks only balance and allowance. A token whose `transferFrom` reverts for other reasons (blocklist, pause) would revert the whole batch.
8. **Stray tokens.** Tokens sent directly to the vault (not through the protocol) are credited to nobody and are stuck.
9. **Entitlement cache.** The gateway caches entitlement for 15 s, so a wallet may get up to 15 s of service after its entitlement ends. That is far below any realistic period, but it is not zero.
10. **Unvalidated metadata.** Plan metadata is a free-form string (seeded as a `data:` JSON URI).
11. **Results not yet measured** (Chapter 9): Sepolia lifecycle, live-AIPG latency and committed epochs on the testnet. The cost model prices gas on Base, not on Ethereum Sepolia or mainnet, and the local gas figures are cancun-priced (D20, D21).
12. **Simulation realism.** The schedule and outage experiments run on anvil with deterministic inclusion and no competing traffic (§9.5).
13. **Dependence on a third-party network.** Live demonstrations depend on AIPG having a suitable worker online. At snapshot time no `qwen3` worker was online (§9.8). The documented fallback is the identical local stack with mock inference (`docs/DEMO.md`).

*Sources: `docs/REPORT_NOTES.md` §5; SPEC.md §10.*

## 10.2 Future work

**Stretch goals from SPEC.md §11 (not implemented):**

- **ERC-4337 smart-account subscription** **[VERIFY: EIP-4337 citation]**, with a paymaster, so a subscriber holding only mUSDC and no ETH can enrol. The gateway's SIWE verification already accepts ERC-6492 smart-account signatures via viem (D9).
- **Payout splitter.** From an epoch's usage root, allocate the payee's revenue to worker addresses pro rata by tokens served, claimable with a Merkle proof. This would reuse the existing leaf format and `verifyRow`.
- **Chainlink Automation-compatible wrapper** (`checkUpkeep` / `performUpkeep`) as an alternative keeper. `checkUpkeep` would wrap `dueSubscriptions`, and `performUpkeep` would call `chargeBatch`. No change to the vault is needed, because charging is already permissionless.

**Further directions suggested by the limitations:**

- **Reducing trust in metering:** have the upstream (AIPG) sign usage receipts per request (e.g. tied to the grid job id) and include the signature hash in the leaf, so a root commits to provider-attested usage. Alternatively, open a challenge window during which a subscriber can dispute a row with their own copy of the request and response hashes.
- **Usage-based or hybrid pricing:** combine the flat subscription with metered overage settled against committed roots.
- **Due-queue or event-indexed discovery** for large numbers of subscriptions.
- **Permit2** **[VERIFY]** support for tokens without native EIP-2612.
- **Per-wallet upstream keys**, so AIPG can enforce limits itself.
- **Mainnet-grade economics:** measure Ethereum L1 and L2 receipt costs on the live networks and choose `keeperFeeBps` per chain.
- **External audit and formal verification** of I1–I5 (e.g. with an SMT-based checker such as the Solidity SMTChecker or Certora **[VERIFY tool names and suitability]**).
