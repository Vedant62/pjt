# Progress

## Phase 1 — Scaffold ✅
- pnpm workspace (`packages/shared`, `keeper`, `gateway`, `dashboard`, `sim`), Foundry project in `contracts/`.
- OpenZeppelin Contracts v5.1.0 and forge-std are vendored under `contracts/lib/` (sources only, no git submodules) so a fresh clone builds offline.

## Phase 2 — Contracts + test suite ✅
- `MockUSDC`, `PlanRegistry`, `SubscriptionVault`, `UsageRootRegistry` per SPEC §2.
- 72 tests: unit (one file per contract), 3 fuzz (1,000 runs each), 5 handler-based invariants (`invariant_I1`…`I5`, 256 runs × depth 64), and the five `test_KeeperCannot_*` properties.
- `forge coverage`: 100% lines / statements / branches / functions on `src/`.
- Deviations (additive only, see docs/REPORT_NOTES.md): `PlanRegistry.getPlanTerms`, `SubscriptionVault.latestSubOf`, `UsageRootRegistry.getEpoch` + `hashRow`; `price > 0` required; `cancel` on a terminal sub reverts `NotChargeable(status)`.

## Phase 3 — Local stack ✅
- `Deploy.s.sol` / `Seed.s.sol` write `contracts/deployments/<chainId>.json` (+ `.seed.json`); `pnpm sync:abis` regenerates `packages/shared/src/{abis.ts,addresses.json,addresses.ts}`.
- Keeper (`keeper/`): pages `dueSubscriptions`, simulates + sends `chargeBatch`, parses events, appends JSONL to `keeper/logs/keeper-<chainId>.jsonl`, `/health` on :8788, graceful SIGINT/SIGTERM. A tick re-scans until nothing new is due (so a late keeper catches up several periods in one tick).
- Gateway (`gateway/`): SIWE → JWT, `csk_` API keys (hashed), entitlement check with 15 s cache, 402 with on-chain status, model allowlist, `max_tokens` cap, live-mode rate limit + persisted global budget, mock/live upstream behind one code path, SSE passthrough, usage rows in SQLite, epoch job → `StandardMerkleTree` → `commitRoot`, proof endpoints, `/health`.
- `pnpm test:gateway`: 10 end-to-end tests against anvil (SIWE, 402, permit subscribe, stream/non-stream, API keys, epoch commit + on-chain `verifyRow`, JS leaf == Solidity `hashRow`, cancel → paid-through → 402).
- `pnpm local:up` verified: fresh anvil (1 s blocks) → deploy → seed → sync → keeper + gateway; a subscription made with `cast` was charged by the keeper automatically.
- Deviations: SIWE uses viem's built-in EIP-4361 implementation (`viem/siwe`) instead of the `siwe` package (avoids an ethers peer dependency); Node 22 is used locally (spec says 20; code targets ≥ 20).
