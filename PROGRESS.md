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

## Phase 4 — Dashboard ✅
- Next.js 14 App Router + wagmi v2 + RainbowKit + Tailwind. Pages: `/`, `/provider`, `/plans/[id]`, `/chat`, `/activity`, `/attacks`, `/epochs`.
- Anvil-only "dev wallets" (public anvil test keys, wrapped as an EIP-1193 provider) so the local demo runs without a browser extension; they only connect after an explicit click.
- Walked in a browser against `pnpm local:up` (mock mode): permit-subscribe (1 signature + 1 tx) → SIWE sign-in → streamed chat with tokens/TTFT → keeper charged automatically (drift 4 s, shown in /activity) → epoch root committed → /epochs proof verified on-chain (✓, tamper → ✗) → attack panel: all five reverts decoded; "send for real" broadcasts the reverting tx.
- `local:up` seeds one cancelled subscription so attack #3 has a target; `DASHBOARD_PORT` overrides :3000.
- Fixes found while walking: `scrollIntoView` returns a Promise in current Chromium (effect cleanup crash); wagmi's `writeContract` pre-simulates and its receipt wait throws on reverts (bypassed only for the deliberate attack broadcast); wallet SDKs touch `indexedDB` during SSR, so the wallet tree renders client-only.

## Phase 5 — Local experiments ✅
- `pnpm results:local` → `test_summary.json`, `gas_report.{json,md}`, `batch_sweep.json`, `cost_model.json`, `schedule_sim.json`, `keeper_outage.json`; `pnpm results:summary` → figures + `RESULTS.md`.
- Batch sweep uses real anvil receipts (see REPORT_NOTES D10). The cost model measures the Base Sepolia gas price and L1 fee at run time; ETH/USD and a mainnet gas price are labelled assumptions.
- Schedule sim: 500 subscribers, 12 × 30-day periods, ticks 60 s / 600 s / 1 h / 6 h, each on a fresh anvil (seeded jitter so due times don't align with the tick grid). The real `Keeper` class is used.
- Outage: the real keeper process gets SIGTERM (graceful, exit 0), 3 periods pass, then it restarts; all missed charges are recovered, 0 lost, anchored schedule intact.

## Phase 6 — Testnet ⏳ (needs your keys)
Ready to run, not yet run (I have no funded Base Sepolia keys or Etherscan key):
1. Fill `contracts/.env`, then `pnpm deploy:testnet` (deploy + seed + verify + sync).
2. Fill `keeper/.env` and `gateway/.env` (CHAIN_ID=84532), then `pnpm testnet:up`.
3. `cd sim && pnpm lifecycle` (needs `LIFECYCLE_SUBSCRIBER_KEY` and `LIFECYCLE_KEEPER_KEY` in `sim/.env`) and `pnpm grid-snapshot`.
4. Paste the addresses into docs/REPORT_NOTES.md §7.

## Phase 7 — Live AIPG ⏳ (needs AIPG key + credits)
`AIPG_MODE=live` in gateway/.env → create a `csk_` key on /chat for an entitled wallet → `cd sim && pnpm bench` (24 requests by default, asks first) → 3–5 real chats → wait for 2 epochs → `pnpm epochs` → `pnpm results:summary`.

## Phase 8 — Docs (drafted)
ARCHITECTURE.md, DEMO.md, REPORT_NOTES.md and README are written. Screenshots (`docs/screenshots/`, Playwright 1440×900) are deferred until after phase 7, per spec.
