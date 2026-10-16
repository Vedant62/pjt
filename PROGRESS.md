# Progress

## Phase 1 — Scaffold ✅
- pnpm workspace (`packages/shared`, `keeper`, `gateway`, `dashboard`, `sim`), Foundry project in `contracts/`.
- OpenZeppelin Contracts v5.1.0 and forge-std are vendored under `contracts/lib/` (sources only, no git submodules) so a fresh clone builds offline.

## Phase 2 — Contracts + test suite ✅
- `MockUSDC`, `PlanRegistry`, `SubscriptionVault`, `UsageRootRegistry` per SPEC §2.
- 72 tests: unit (one file per contract), 3 fuzz (1,000 runs each), 5 handler-based invariants (`invariant_I1`…`I5`, 256 runs × depth 64), and the five `test_KeeperCannot_*` properties.
- `forge coverage`: 100% lines / statements / branches / functions on `src/`.
- Deviations (additive only, see docs/REPORT_NOTES.md): `PlanRegistry.getPlanTerms`, `SubscriptionVault.latestSubOf`, `UsageRootRegistry.getEpoch` + `hashRow`; `price > 0` required; `cancel` on a terminal sub reverts `NotChargeable(status)`.
