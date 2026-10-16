# Cashew — Build Spec for Claude Code

> Save this file as `SPEC.md` in the root of an empty repo and tell Claude Code to read it and build. Every section is binding unless marked *stretch*.

---

## 0. Context and ground rules

**What this is.** Cashew is a B.Tech capstone: a decentralized protocol for recurring (subscription) payments on EVM chains. A provider publishes a plan on-chain. A subscriber signs **one** EIP-712 permit to enrol. An **untrusted, permissionless keeper** triggers each charge when it falls due. The contract, not the allowance, enforces the limit: at most the plan price, at most once per elapsed period.

**The use case it is demonstrated on.** The subscription sells access to **AI Power Grid (AIPG)**, a live decentralized inference network with an OpenAI-compatible API at `https://api.aipowergrid.io`. We do **not** run grid-core. We hold **one** AIPG API key and have our own GPU worker connected to the grid serving `qwen3:8b` (also `qwen3:4b`, `qwen3:1.7b`). A **Cashew Gateway** sits in front of AIPG. It lets a wallet use the API only while that wallet's on-chain subscription is entitled. It meters usage and commits a Merkle root of usage rows on-chain once per epoch.

**Target chain.** Base Sepolia (chainId `84532`, RPC `https://sepolia.base.org`, explorer `https://sepolia.basescan.org`). Settlement token is our own **MockUSDC** (6 decimals, ERC-2612 permit, open mint). Nothing here touches mainnet or real money.

**Ground rules (important):**
1. **Never invent results.** Every number in `results/` must come from a script that ran. If something can't be measured, write `null` and say why in `results/RESULTS.md`. These numbers go into an academic report and will be questioned by a panel.
2. **Protect the AIPG credit balance (~0.9 credits).** All development and tests use the gateway's `AIPG_MODE=mock`. Real AIPG calls happen only in `AIPG_MODE=live`, and in live mode:
   - `max_tokens` is capped at 256
   - there is a per-wallet rate limit (10 req/min)
   - a hard global budget `AIPG_MAX_LIVE_REQUESTS` (default 150) is enforced, after which the gateway refuses with 503
3. Work in the phases in §9, in order. After each phase run its checks, commit (`git commit`), and update `PROGRESS.md` (what's done, what's next, any deviation from this spec and why).
4. Keep `docs/REPORT_NOTES.md` up to date as you go (see §10). It feeds the project report.
5. Prefer boring, well-known libraries: Foundry + OpenZeppelin Contracts v5, Node 20 + TypeScript + viem, Next.js 14 App Router + wagmi v2 + RainbowKit + Tailwind, SQLite (better-sqlite3), `@openzeppelin/merkle-tree`. Use pnpm workspaces.
6. Secrets live only in `.env` files (gitignored), with `.env.example` committed for each package.

---

## 1. Repository layout

```
cashew/
├─ SPEC.md                 ← this file
├─ PROGRESS.md
├─ README.md               ← quickstart: local demo + testnet demo
├─ package.json            ← pnpm workspace root, top-level scripts (§8)
├─ contracts/              ← Foundry project
│  ├─ src/
│  │  ├─ MockUSDC.sol
│  │  ├─ PlanRegistry.sol
│  │  ├─ SubscriptionVault.sol
│  │  └─ UsageRootRegistry.sol
│  ├─ test/                ← unit, fuzz, invariant (handler-based)
│  └─ script/              ← Deploy.s.sol, Seed.s.sol, GasSweep.s.sol
├─ packages/shared/        ← generated ABIs, deployed addresses per chain, shared TS types
├─ keeper/                 ← Node/TS keeper service
├─ gateway/                ← Node/TS entitlement gateway + metering + epoch roots
├─ dashboard/              ← Next.js app
├─ sim/                    ← TS simulation + benchmark scripts (run against anvil / live gateway)
├─ results/                ← machine-written results (JSON/CSV/PNG) + RESULTS.md
└─ docs/
   ├─ ARCHITECTURE.md
   ├─ DEMO.md              ← minute-by-minute live demo runbook
   └─ REPORT_NOTES.md
```

`packages/shared` must hold an auto-generated `addresses.json` keyed by chainId (`31337` local, `84532` Base Sepolia) and the ABIs, generated after each deploy by a script (`pnpm sync:abis`). Every other package imports from here. No hard-coded addresses anywhere else.

---

## 2. Smart contracts (Solidity ^0.8.24, OpenZeppelin v5)

### 2.1 `MockUSDC.sol`
- `ERC20("Mock USD Coin","mUSDC")` + `ERC20Permit`, `decimals() = 6`.
- `mint(address to, uint256 amount)`: open to anyone, capped at 1,000 mUSDC per call (testnet faucet).

### 2.2 `PlanRegistry.sol`
```solidity
struct Plan {
    address provider;     // msg.sender at creation
    address payee;        // receives revenue; immutable
    address token;        // ERC-20 settlement token; immutable
    uint96  price;        // per-period price in token units; immutable
    uint32  period;       // seconds; immutable; > 0
    uint32  gracePeriod;  // seconds; immutable; MUST be < period
    bool    active;       // provider can close to NEW subscriptions only
    string  metadataURI;  // name/description/features (JSON or ipfs://)
}
function createPlan(address token, uint96 price, uint32 period, uint32 gracePeriod,
                    address payee, string calldata metadataURI) external returns (uint256 planId);
function setPlanActive(uint256 planId, bool active) external;   // onlyProvider
function getPlan(uint256 planId) external view returns (Plan memory);
function planCount() external view returns (uint256);
event PlanCreated(uint256 indexed planId, address indexed provider, address indexed payee,
                  address token, uint96 price, uint32 period, uint32 gracePeriod, string metadataURI);
event PlanActiveSet(uint256 indexed planId, bool active);
```
Price, period, token and payee **cannot** change after creation. There is deliberately no setter.

### 2.3 `SubscriptionVault.sol`
Reads plans from `PlanRegistry`. Uses `SafeERC20`, `ReentrancyGuard`.

```solidity
enum Status { None, Active, PastDue, Lapsed, Cancelled }
struct Subscription {
    address subscriber;
    uint64  planId;
    uint64  startedAt;
    uint64  nextChargeAt;   // anchored schedule: advances by exactly `period` per successful charge
    uint64  pastDueSince;   // 0 unless PastDue
    uint32  chargeCount;
    Status  status;
}
uint16 public immutable keeperFeeBps;   // e.g. 25 = 0.25% of price, paid to the caller of a successful charge

function subscribeWithPermit(uint256 planId, uint256 permitValue, uint256 deadline,
                             uint8 v, bytes32 r, bytes32 s) external returns (uint256 subId);
function subscribe(uint256 planId) external returns (uint256 subId);   // for wallets that already approved
function charge(uint256 subId) external;                                // anyone
function chargeBatch(uint256[] calldata subIds) external returns (uint256 ok, uint256 failed, uint256 skipped);
function cancel(uint256 subId) external;                                // subscriber only
function withdraw(address token) external;                              // pays msg.sender's own claimable balance
// views
function isEntitled(uint256 subId) external view returns (bool);
function entitledSubOf(address subscriber, uint256 planId) external view returns (uint256 subId); // 0 if none
function getSubscription(uint256 subId) external view returns (Subscription memory);
function claimable(address account, address token) external view returns (uint256);
function dueSubscriptions(uint256 cursor, uint256 limit) external view
         returns (uint256[] memory ids, uint256 nextCursor);           // for keepers
function subscriptionCount() external view returns (uint256);
```

**Semantics (these are the protocol; tests must cover every line):**
- **Subscribe.** `subscribeWithPermit` calls `token.permit(...)` inside `try/catch`. If the permit was front-run, it continues as long as the allowance is sufficient. It then pulls the **first period immediately**, sets `status = Active`, `nextChargeAt = now + period`. The plan must be `active`. A wallet may hold at most one non-terminal subscription per plan. The dashboard uses `permitValue = price × 12` (12 cycles). The vault still never pulls more than `price` per period.
- **Charge (single).** Callable by anyone. Reverts with custom errors:
  - `NotDue()` if `block.timestamp < nextChargeAt` (covers "charge early" and "charge twice in a period")
  - `NotChargeable(Status)` if status is `None`, `Lapsed` or `Cancelled`

  Otherwise:
  - If `now >= nextChargeAt + gracePeriod` and the charge cannot be collected → set `Lapsed`, emit `SubscriptionLapsed`, return (no revert, no fee).
  - If the subscriber's balance or allowance is < price → set `PastDue` (record `pastDueSince = nextChargeAt` the first time), emit `ChargeFailed(subId, reason)` (`reason`: 1 = balance, 2 = allowance), return (no revert, no fee).
  - Otherwise pull exactly `price`, credit `claimable[payee] += price - fee`, `claimable[msg.sender] += fee`, `nextChargeAt += period`, `chargeCount++`, status back to `Active`, clear `pastDueSince`, emit `Charged(subId, planId, amount, fee, keeper, newNextChargeAt)`.
- **There is no amount parameter anywhere.** The amount is always `plan.price`.
- **Batch.** `chargeBatch` never reverts on a single bad id. It skips not-due or non-chargeable ids (`skipped++`) and counts `ok` / `failed` (failed = PastDue or Lapsed transitions). Max 200 ids per call.
- **Cancel.** Subscriber only (`NotSubscriber()` otherwise). Status `Cancelled`, emit `Cancelled`. A cancelled sub stays **entitled until `nextChargeAt`** (paid-through), and can never be charged again.
- **Entitlement.**
  ```
  isEntitled = (status == Active || status == PastDue) && now < nextChargeAt + gracePeriod
               || (status == Cancelled && now < nextChargeAt)
  ```
  So a late keeper doesn't cut access during grace, and a failed payment cuts access once grace ends.
- **Withdraw** pays only `msg.sender`'s own balance (`NothingToWithdraw()` if zero). Payees and keepers both withdraw this way.
- **Solvency.** `token.balanceOf(vault) == Σ claimable[*][token]` at all times.
- **Liveness.** If no keeper calls for several periods, charges are late, not lost. Each call collects one period (anchored schedule), so repeated calls catch up one period at a time. Because `gracePeriod < period`, a sub that is never charged lapses, rather than accumulating debt indefinitely.

Events: `Subscribed`, `Charged`, `ChargeFailed`, `SubscriptionLapsed`, `Cancelled`, `Withdrawn`.

### 2.4 `UsageRootRegistry.sol`
```solidity
function setCommitter(address committer, bool allowed) external;        // onlyOwner (Ownable)
function commitRoot(uint256 planId, uint64 epoch, bytes32 root, uint64 rowCount,
                    uint128 totalTokens, string calldata uri) external; // onlyCommitter; one root per (planId, epoch)
function verifyRow(uint256 planId, uint64 epoch, bytes32[] calldata proof, bytes32 leaf) external view returns (bool);
function rootOf(uint256 planId, uint64 epoch) external view returns (bytes32);
event RootCommitted(uint256 indexed planId, uint64 indexed epoch, bytes32 root, uint64 rowCount, uint128 totalTokens, string uri);
```
Leaf encoding must match `@openzeppelin/merkle-tree` `StandardMerkleTree` (double-hashed), with leaf type
`["uint64 epoch","address wallet","uint256 subId","string model","uint32 promptTokens","uint32 completionTokens","bytes32 requestHash","bytes32 responseHash","uint64 timestamp"]`.

### 2.5 Deploy scripts
- `Deploy.s.sol`: deploys all four contracts (keeperFeeBps = 25), sets the gateway address as committer, writes addresses JSON.
- `Seed.s.sol`: creates the **demo plan**: price 20 mUSDC, `period = 180` s, `gracePeriod = 60` s, metadata "AI Power Grid Access — demo cadence". Also a **production-shaped plan**: 20 mUSDC, 30 days, 3 days grace. Mints mUSDC to the subscriber test wallets.
- Verify on BaseScan (`forge verify-contract` with Etherscan v2 API key from `.env`).

---

## 3. Contract tests (Foundry) — `contracts/test/`

**Unit tests**, one file per contract. Cover every revert and every state transition, including:
- permit front-run fallback
- duplicate subscription rejected
- inactive plan rejected
- `grace >= period` rejected
- withdraw zero

**Fuzz tests**, at least:
- charged amount always equals `plan.price` for random prices and periods
- charge before `nextChargeAt` always reverts
- `nextChargeAt` after k successful charges = `startedAt + (k+1)·period`

**Invariant tests** (handler-based, `invariant_*`, ≥ 256 runs × depth 64). Name each invariant exactly as below so the report can cite them:
- `invariant_I1_noOvercharge`: for every subscriber, total pulled ≤ `price × (1 + floor((now - startedAt)/period))`
- `invariant_I2_noChargeAfterTerminal`: no `Charged` after `Cancelled` or `Lapsed`
- `invariant_I3_solvency`: vault balance == Σ claimable
- `invariant_I4_anchoredSchedule`: `nextChargeAt == startedAt + period × chargeCount`
- `invariant_I5_ownFundsOnly`: no account's withdrawals exceed its credited amount

**The five "keeper cannot" properties.** Each gets a named test, `test_KeeperCannot_*`:
1. `ChargeEarly`
2. `ChargeTwiceInPeriod`
3. `ChargeCancelled`
4. `PullMoreThanPrice`: the attacker calls `token.transferFrom(subscriber, attacker, x)` directly → reverts with `ERC20InsufficientAllowance`. The vault has no amount parameter.
5. `RedirectPayeeFunds`: an attacker's `withdraw` cannot take the payee's balance; there is no payee setter.

---

## 4. Keeper — `keeper/`

Node 20 + TypeScript + viem. Config via `.env`:

| Variable | Meaning |
|---|---|
| `RPC_URL`, `CHAIN_ID`, `KEEPER_PRIVATE_KEY` | chain access and the keeper's wallet |
| `TICK_SECONDS` | default 15 for the demo; 21600 (6 h) for the production profile |
| `BATCH_SIZE` | default 100 |

Loop:
1. Every tick, page through `dueSubscriptions(cursor, 500)`.
2. Chunk the ids into `BATCH_SIZE`.
3. `simulateContract` → `chargeBatch` → wait for the receipt.
4. Parse the `Charged` / `ChargeFailed` / `SubscriptionLapsed` logs.
5. Append one JSON line per sub to `keeper/logs/keeper-<chainId>.jsonl`: `{ts, subId, scheduledAt (the nextChargeAt that was due), executedAt (block timestamp), driftSeconds, outcome, txHash, gasUsed, batchSize}`.

Also:
- A `GET /health` on port 8788 returning the last tick, queue size, and the keeper's mUSDC claimable.
- A graceful-shutdown and restart test: kill it for 3 periods, restart, and confirm it catches up with zero lost charges. Document the result in `results/keeper_outage.json`.

---

## 5. Gateway — `gateway/`

Node 20 + TypeScript + Express (or Hono) + viem + better-sqlite3 + `@openzeppelin/merkle-tree`. Port 8787.

**Auth.**
- `GET /auth/nonce` and `POST /auth/verify`: Sign-In With Ethereum (EIP-4361, the `siwe` package) → a short-lived JWT bound to the wallet address.
- `POST /keys` (JWT required) → issues a gateway API key `csk_…` bound to the wallet, stored hashed in SQLite, for curl/SDK use.
- Both JWT and `Authorization: Bearer csk_…` are accepted on `/v1/*`.

**`POST /v1/chat/completions`** (OpenAI-compatible, `stream` true or false):
1. Resolve wallet → `subId = entitledSubOf(wallet, PLAN_ID)`.
2. Check `isEntitled(subId)` (15 s in-memory cache).
3. If not entitled → `402 Payment Required` with JSON body `{error:{type:"payment_required", status:"<on-chain status>", subId, nextChargeAt, message}}`.
4. Enforce the model allowlist (`ALLOWED_MODELS`, default `qwen3:8b,qwen3:4b,qwen3:1.7b`), the `max_tokens` cap, the rate limit and the live budget (§0).
5. Forward to `${AIPG_BASE_URL}/v1/chat/completions` with `Authorization: Bearer ${AIPG_API_KEY}`. Stream SSE back unchanged; for streams, request `stream_options: {include_usage: true}`.
6. Capture `X-Grid-Job-ID` if AIPG returns it.
7. Write a usage row to SQLite: `{id, epoch, wallet, subId, model, promptTokens, completionTokens, requestHash = keccak256(canonical request JSON), responseHash = keccak256(full response text), timestamp, gridJobId, ttftMs, totalMs}`.

**`GET /v1/models`**: the allowlisted models, enriched from AIPG `GET /v1/models` when live.

**`AIPG_MODE=mock`**: no network. Returns a streamed canned completion with realistic token usage and configurable latency. This is the default.

**Epoch job.**
1. Every `EPOCH_SECONDS` (demo 300), close the epoch.
2. Build a `StandardMerkleTree` over that epoch's rows (leaf schema in §2.4).
3. Write `gateway/epochs/<planId>-<epoch>.json` (`tree.dump()` + row ids).
4. Call `commitRoot`. If an epoch has zero rows, skip it.

**Verification endpoints.**
- `GET /epochs` lists committed epochs with tx hashes.
- `GET /epochs/:epoch/proof/:rowId` returns `{leaf values, proof}`.

**`GET /health`** reports mode, the remaining live budget, the last committed epoch and the entitlement cache size.

---

## 6. Dashboard — `dashboard/`

Next.js 14 (App Router) + TypeScript + wagmi v2 + viem + RainbowKit + Tailwind. Chains: Anvil (31337) and Base Sepolia (84532). Clean, legible UI; every tx hash links to BaseScan. Pages:

| Route | Purpose |
|---|---|
| `/` | Overview: deployed contract addresses (BaseScan links), keeper and gateway health, plan list, live counters (active subs, total charged, last root). |
| `/provider` | Create plan form (token, price, period, grace, payee, metadata). My plans. Claimable balance + Withdraw. |
| `/plans/[id]` | Plan terms. **Get test mUSDC** button (mint 100). **Subscribe** = one EIP-712 permit signature + one tx. Subscription card: status badge, `nextChargeAt` countdown, charge count, allowance cycles remaining, entitled yes/no. **Cancel** button. **Top up / re-approve** button. |
| `/chat` | SIWE sign-in → model picker → streaming chat through the gateway. On 402, show a clear banner with on-chain status and a link to `/plans/[id]`. Show per-message tokens and TTFT. |
| `/activity` | Live event feed (`watchContractEvent`) for Subscribed / Charged / ChargeFailed / SubscriptionLapsed / Cancelled / RootCommitted, with tx links, keeper address and drift. |
| `/attacks` | **Attack panel.** The five attacks from §3, each a button run from the connected (attacker) wallet. Each first `simulateContract`s and shows the decoded custom error. An optional "send for real" toggle broadcasts the tx so the failed tx is visible on BaseScan. |
| `/epochs` | Committed roots. Pick a usage row → fetch its proof from the gateway → call `verifyRow` on-chain → show ✓ / ✗. |

---

## 7. Experiments → `results/` (exact file names; the report depends on them)

All scripts live in `sim/` or `contracts/script/` and are runnable via the pnpm scripts in §8. Each writes JSON (and CSV where tabular), then `sim/plots.py` (matplotlib, 300 dpi, white background, no titles inside the image, axis labels with units) renders the PNGs.

| File | Produced by | Content |
|---|---|---|
| `results/test_summary.json` | `forge test --json` parsed | counts of unit / fuzz / invariant tests, passed / failed, fuzz runs, invariant runs × depth, the five `KeeperCannot` results |
| `results/gas_report.json` + `.md` | `forge test --gas-report` parsed | min / avg / median / max gas for `createPlan`, `subscribeWithPermit`, `subscribe`, `charge`, `chargeBatch`, `cancel`, `withdraw`, `commitRoot` |
| `results/batch_sweep.json` + `fig_batch_sweep.png` | `GasSweep.s.sol` on anvil | for batch sizes 1, 5, 10, 25, 50, 100, 200: total gas, gas per subscriber |
| `results/cost_model.json` | `sim/cost.ts` | measured gas × **stated** assumptions (Base Sepolia observed gas price at run time, plus a configurable L2 gas price and ETH/USD clearly labelled as assumptions) → $ per op and charge cost as a % of a 20 USDC cycle |
| `results/schedule_sim.json` + `fig_drift_cdf.png` | `sim/schedule.ts` on anvil with `evm_increaseTime` | 500 subscribers, staggered start times, 12 periods of 30 days. Keeper tick intervals 60 s, 600 s, 3600 s, 21600 s. Per tick: due charges, executed, missed, drift p50 / p95 / max |
| `results/keeper_outage.json` | `sim/outage.ts` on anvil | keeper offline for 3 periods → restart → charges recovered, lost (expect 0), sequence of `nextChargeAt` |
| `results/lifecycle_testnet.json` | `sim/lifecycle.ts` on **Base Sepolia** | a scripted run: subscribe → 3 keeper charges → drain balance → ChargeFailed → PastDue → top up → recovered → cancel → entitled until paid-through → not entitled. Every step records tx hash, block timestamp, gas, status |
| `results/gateway_bench.json` + `fig_ttft.png` | `sim/bench.ts` (**live**, ≤ 30 requests total) | TTFT and total latency, direct to AIPG vs through the gateway, same prompt and model (`qwen3:8b`, `max_tokens` 64). Gateway overhead p50 / p95. Entitlement-check latency, cached vs uncached. |
| `results/grid_snapshot.json` | `sim/grid_snapshot.ts` (no credits used) | `GET /v1/workers` and `GET /v1/status/models` at run time: workers online, models, our workers' status |
| `results/epochs.json` | gateway | committed epochs: rows, tokens, root, tx hash, one verified inclusion proof |
| `results/RESULTS.md` | `sim/summarize.ts` | human-readable summary of all the above with the run date, commit hash and every assumption stated |

---

## 8. Top-level scripts (root `package.json`)

| Script | Does |
|---|---|
| `pnpm i` | install everything |
| `pnpm test:contracts` | `forge test -vvv` |
| `pnpm local:up` | starts anvil, deploys + seeds, syncs ABIs, starts keeper + gateway (mock) + dashboard concurrently |
| `pnpm deploy:testnet` | deploy + seed + verify on Base Sepolia, sync ABIs |
| `pnpm testnet:up` | keeper + gateway against Base Sepolia (`AIPG_MODE` from `.env`) + dashboard |
| `pnpm results:local` | test_summary, gas_report, batch_sweep, cost_model, schedule_sim, keeper_outage |
| `pnpm results:testnet` | lifecycle_testnet, grid_snapshot, gateway_bench (asks for confirmation before live AIPG calls), epochs |
| `pnpm results:summary` | plots + RESULTS.md |

---

## 9. Phases (commit after each; don't start the next until checks pass)

1. **Scaffold.** Monorepo, Foundry, pnpm workspace, `.env.example`s, README skeleton.
2. **Contracts + full test suite** (§2, §3).
   *Check:* `forge test` green, invariants ≥ 256 runs, `forge coverage` ≥ 90% lines on `src/`.
3. **Local stack.** Deploy/seed scripts, `packages/shared`, keeper, gateway (mock mode).
   *Check:* `pnpm local:up` works end-to-end from a fresh clone.
4. **Dashboard.** All §6 pages working against anvil.
   *Check:* walk the whole DEMO.md flow locally in mock mode.
5. **Local experiments** (`pnpm results:local`).
6. **Testnet.** Deploy + verify on Base Sepolia, `testnet:up`, `lifecycle_testnet`, `grid_snapshot`.
7. **Live AIPG.** Switch the gateway to live, run `gateway_bench` (≤ 30 requests), do 3–5 real chats on the demo plan, let 2 epochs commit, then `results:summary`.
8. **Docs.** Finalize ARCHITECTURE.md, DEMO.md, REPORT_NOTES.md, and screenshots (see §10).

---

## 10. Documentation outputs

**`docs/DEMO.md`**: an 8–10 minute runbook. Pre-flight checklist (wallet balances, faucets, worker online, gateway live budget, keeper running), then:
1. Show the deployed + verified contracts.
2. Provider creates a plan (or shows the seeded one).
3. Subscriber mints mUSDC, signs once, subscribes.
4. Chat with `qwen3:8b` through the gateway; show the worker in `/v1/workers`.
5. Wait one period: the keeper charges with no human in the loop; show it in `/activity` + BaseScan.
6. Attack panel: five reverts.
7. Drain the balance → ChargeFailed → PastDue → after grace, chat returns 402 → top up → recovered.
8. Cancel → entitled until paid-through → then 402.
9. `/epochs`: the root is on-chain; verify a row's inclusion proof.

Include a fallback plan if the testnet RPC or AIPG is down (switch to the local anvil + mock stack and say so).

**`docs/ARCHITECTURE.md`**: components, data flow, trust assumptions, Mermaid diagrams (component, state machine, one-period sequence, keeper loop).

**`docs/REPORT_NOTES.md`**: for the project report. Keep it current:
- final contract interfaces as built
- every deviation from SPEC.md and why
- design decisions with rationale
- the threat model (what the keeper, gateway, provider and subscriber can and cannot do)
- known limitations, stated honestly. For example:
  - the gateway is a trusted metering party, and the root only proves what the gateway recorded
  - payouts to workers are not automated (*stretch*)
  - mock token, not real USDC
  - no audit
  - testnet only
  - a single AIPG key is shared behind the gateway
- versions of all tools and libraries
- deployed addresses + verification links

**`docs/screenshots/`**: after phase 7, take PNG screenshots (Playwright, 1440×900) of every dashboard page in a meaningful state, plus the 402 banner and the attack panel results. Name them `01-overview.png`, `02-provider.png`, …

---

## 11. Stretch (only after phase 8)
- ERC-4337 smart-account subscribe so a subscriber with only mUSDC and no ETH can enrol (paymaster on Base Sepolia).
- Payout splitter: from an epoch root, allocate the payee's revenue to worker addresses pro-rata by tokens served, claimable with a Merkle proof.
- Chainlink Automation-compatible `checkUpkeep` / `performUpkeep` wrapper as an alternative keeper.
