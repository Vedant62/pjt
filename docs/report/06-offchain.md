# Chapter 6 — Off-Chain Components

All off-chain code is TypeScript on Node.js (≥ 20; developed on Node 22, deviation D12) using viem for chain access. Contract ABIs and per-chain addresses are generated into `packages/shared` after each deployment (`pnpm sync:abis`). No other package hard-codes an address.

## 6.1 Keeper (`keeper/`)

The keeper is a small service whose only on-chain power is calling `chargeBatch`, which anyone can do.

**Configuration.** `RPC_URL`, `CHAIN_ID`, `KEEPER_PRIVATE_KEY`, `TICK_SECONDS` (15 s for the demo, 21,600 s for the production profile) and `BATCH_SIZE` (default 100) (SPEC.md §4).

**Loop** (`keeper/src/keeper.ts`, Figure 4.4):

1. Every tick, page through `dueSubscriptions(cursor, 500)` until the cursor returns 0.
2. Drop ids that already failed in this tick (they are retried next tick).
3. Chunk the remaining ids into `BATCH_SIZE`.
4. `simulateContract(chargeBatch)`, send the transaction, wait for the receipt.
5. Parse `Charged`, `ChargeFailed` and `SubscriptionLapsed` logs.
6. Append one JSON line per subscription to `keeper/logs/keeper-<chainId>.jsonl`: `{ts, subId, scheduledAt, executedAt, driftSeconds, outcome, txHash, gasUsed, batchSize}`.
7. Re-scan in the same tick (up to `maxRounds`, default 16) so that a keeper returning from an outage catches up several periods at once. Each call still settles only one period per subscription.

`GET /health` on port 8788 reports the last tick, queue size and the keeper's claimable mUSDC. SIGINT/SIGTERM trigger a graceful shutdown. This was used in the outage experiment (§9.6).

**Why so simple?** Correctness lives in the vault. The keeper holds no state that matters: if it crashes, restarts, or runs alongside other keepers, the worst case is a reverted or skipped call. Two keepers racing for the same subscription simply see `skipped` for ids the other already charged.

## 6.2 Cashew Gateway (`gateway/`)

The gateway is an Express server on port 8787 with SQLite (better-sqlite3) storage. It turns on-chain entitlement into HTTP access control for AIPG.

### 6.2.1 Authentication

- **SIWE (EIP-4361).** `GET /auth/nonce` issues a nonce. `POST /auth/verify` checks the signed SIWE message with viem's `verifySiweMessage` (deviation D9; it also supports ERC-6492 smart-account signatures) and returns a JWT bound to the wallet address, valid for 1 hour (`gateway/src/auth.ts`).
- **API keys.** `POST /keys` (JWT required) issues a `csk_…` key bound to the wallet, for use with curl or OpenAI SDKs. Keys are stored as SHA-256 hashes. A `csk_` key cannot mint further keys (D15), so a leaked key cannot multiply.
- `/v1/*` accepts either a JWT or `Authorization: Bearer csk_…`.

### 6.2.2 `POST /v1/chat/completions`

The handler (`gateway/src/app.ts`) runs these steps in order:

1. **Entitlement.** Resolve the wallet's subscription with `entitledSubOf(wallet, PLAN_ID)`, falling back to `latestSubOf` to report status. Results are cached in memory for 15 s per wallet. Response headers `X-Cashew-Entitlement-Ms` and `X-Cashew-Entitlement-Cache: hit|miss` expose the check's latency. If the chain is unreachable, the gateway returns `502 chain_unavailable` (it fails closed).
2. **402 Payment Required** if not entitled, with a JSON body such as:
   ```json
   {"error":{"type":"payment_required","status":"PastDue","subId":"3","nextChargeAt":…,"planId":"1",
             "message":"Subscription 3 is PastDue and not entitled. Top up / re-subscribe to restore access."}}
   ```
3. **Policy.** Model allowlist (`ALLOWED_MODELS`, default `qwen3:8b,qwen3:4b,qwen3:1.7b`; otherwise `400 model_not_allowed`) and a `max_tokens` cap. In live mode only: a per-wallet rate limit of 10 requests/min (`429` with `Retry-After`) and a global live budget `AIPG_MAX_LIVE_REQUESTS` (default 150), reserved in SQLite *before* the upstream call so restarts and concurrent requests cannot exceed it (`503 live_budget_exhausted`).
4. **Forward** to `${AIPG_BASE_URL}/v1/chat/completions` with the gateway's own AIPG key. For streams, request `stream_options: {include_usage: true}` and pass the SSE bytes back unchanged.
5. **Meter.** Write a usage row: `{id, epoch, wallet, subId, model, promptTokens, completionTokens, requestHash, responseHash, timestamp, gridJobId, ttftMs, totalMs, usageSource}`.
   - `requestHash = keccak256(canonical JSON of the forwarded body, keys sorted)`.
   - `responseHash = keccak256(assistant message content)`. For streams this is the concatenated deltas, so streamed and non-streamed responses hash the same way (D16).
   - If AIPG omits the usage block, tokens are estimated (characters / 4) and the row is flagged `usageSource = "estimated"` instead of silently inventing numbers (D17). The flag is not part of the Merkle leaf.

**Mock and live share one code path.** In `AIPG_MODE=mock` (the default) the upstream call is replaced by a synthetic `Response` (JSON or SSE) with configurable latency (`MOCK_TTFT_MS`, default 350; `MOCK_TOKEN_MS`, default 20). Tests and the local demo therefore exercise the same streaming, metering and hashing code that live mode uses, without spending AIPG credits.

`GET /v1/models` returns the allowlisted models, enriched from AIPG's `/v1/models` in live mode.

### 6.2.3 Epochs and usage roots

Epoch number = ⌊timestamp / `EPOCH_SECONDS`⌋ (300 s in the demo configuration). A timer closes each epoch and, for every closed epoch with rows and no root yet (`gateway/src/epochs.ts`):

1. builds a `StandardMerkleTree` over the epoch's rows with the leaf schema of §5.10;
2. writes `gateway/epochs/<planId>-<epoch>.json` (`tree.dump()` plus row ids);
3. checks `rootOf` (idempotent restart) and calls `commitRoot(planId, epoch, root, rowCount, totalTokens, uri)`.

Empty epochs are skipped. `GET /epochs` lists committed epochs with transaction hashes. `GET /epochs/:epoch/proof/:rowId` returns the leaf values and the proof, which anyone can check with `verifyRow` on-chain.

**What a root proves.** It proves that a row with exactly these values was in the set the gateway committed for that epoch. It does *not* prove that the gateway recorded every request, or that the token counts match what AIPG actually served. The gateway is a trusted metering party (Chapters 7 and 10).

### 6.2.4 Health

`GET /health` reports the mode, the remaining live budget, the last committed epoch and the entitlement cache size (gateway e2e test "health reports mode, budget, epoch and cache").

## 6.3 Dashboard (`dashboard/`)

Next.js 14 (App Router), wagmi v2, viem, RainbowKit and Tailwind. Every transaction hash links to the block explorer.

| Route | Purpose |
|---|---|
| `/` | Deployed addresses, keeper and gateway health, plan list, live counters |
| `/provider` | Create a plan; my plans; claimable balance and Withdraw |
| `/plans/[id]` | Plan terms; **Get test mUSDC**; **Subscribe** (one EIP-712 permit signature + one transaction); subscription card (status, countdown, charge count, allowance cycles remaining, entitled); Cancel; Top up |
| `/chat` | SIWE sign-in, model picker, streaming chat via the gateway; on 402 a banner with the on-chain status and a link to the plan; per-message tokens and TTFT |
| `/activity` | Live event feed (Subscribed, Charged, ChargeFailed, SubscriptionLapsed, Cancelled, RootCommitted) with keeper address and drift |
| `/attacks` | The five attacks of §3.3, run from the connected wallet. Each is first simulated and the decoded custom error shown. Optional "send for real" broadcasts the failing transaction. |
| `/epochs` | Committed roots; pick a usage row, fetch its proof, call `verifyRow` on-chain, show ✓/✗ (with a tamper toggle that should show ✗) |

For the local demo, the dashboard offers anvil-only "dev wallets" backed by the public anvil test keys. They work only on chain 31337 and are disabled in `testnet:up` (D18). `local:up` seeds one cancelled subscription so attack #3 has a target (D19).

Problems found and fixed while walking the dashboard (PROGRESS.md, Phase 4): `scrollIntoView` returning a Promise in current Chromium, wagmi's pre-simulation and receipt wait throwing on deliberate reverts, and wallet SDKs touching `indexedDB` during server-side rendering.

> **[PENDING: docs/screenshots/]** Insert Figures 6.1–6.9 here: `01-overview.png`, `02-provider.png`, plan/subscribe, chat (including the 402 banner), activity, attack panel results, epochs/verify. SPEC.md §10 asks for Playwright captures at 1440×900. The folder is currently empty.

## 6.4 Experiment scripts (`sim/`)

Each script writes a JSON file to `results/` that records the script name, generation time and git commit. `sim/src/summarize.ts` renders `results/RESULTS.md`, and `sim/plots.py` (matplotlib) renders the figures. Chapter 9 describes each experiment.

| Script | Output | Network |
|---|---|---|
| `sim/src/test-summary.ts` | `test_summary.json` | — (`forge test --json`) |
| `sim/src/gas-report.ts` | `gas_report.json/.md` | — (`forge test --gas-report`) |
| `sim/src/batch-sweep.ts` | `batch_sweep.json` | anvil |
| `sim/src/cost.ts` | `cost_model.json` | reads Base Sepolia gas price |
| `sim/src/schedule.ts` | `schedule_sim.json` | anvil + time travel |
| `sim/src/outage.ts` | `keeper_outage.json` | anvil + real keeper process |
| `sim/src/lifecycle.ts` | `lifecycle_testnet.json` | Ethereum Sepolia |
| `sim/src/grid-snapshot.ts` | `grid_snapshot.json` | AIPG (no credits used) |
| `sim/src/bench.ts` | `gateway_bench.json` | AIPG live (≤ 30 requests) |
| `sim/src/epochs.ts` | `epochs.json` | testnet gateway |
