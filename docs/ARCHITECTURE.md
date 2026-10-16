# Architecture

Cashew has four on-chain contracts and three off-chain services. The contracts hold all value and enforce every payment rule. The off-chain services do no custody: they only trigger permitted actions (keeper), meter usage (gateway), or display state (dashboard).

## Components

```mermaid
flowchart LR
  subgraph Chain["Base Sepolia (or anvil)"]
    USDC["MockUSDC<br/>ERC-20 + ERC-2612 permit"]
    REG["PlanRegistry<br/>immutable plan terms"]
    VAULT["SubscriptionVault<br/>subscribe · charge · cancel · withdraw"]
    ROOTS["UsageRootRegistry<br/>one Merkle root per (plan, epoch)"]
  end
  SUB(("Subscriber wallet"))
  PROV(("Provider / payee"))
  KEEP["Keeper (anyone)<br/>keeper/"]
  GW["Cashew Gateway<br/>gateway/ :8787"]
  AIPG["AI Power Grid<br/>api.aipowergrid.io"]
  WORKER["Our GPU worker<br/>qwen3:8b / 4b / 1.7b"]
  DASH["Dashboard<br/>dashboard/ :3000"]

  PROV -- createPlan --> REG
  SUB -- "permit signature + subscribeWithPermit" --> VAULT
  VAULT -- reads terms --> REG
  VAULT -- "transferFrom (price only)" --> USDC
  KEEP -- "dueSubscriptions / chargeBatch" --> VAULT
  PROV -- withdraw --> VAULT
  SUB -- "SIWE + /v1/chat/completions" --> GW
  GW -- "entitledSubOf / isEntitled (15 s cache)" --> VAULT
  GW -- "forward (one shared API key)" --> AIPG
  AIPG --> WORKER
  GW -- "commitRoot every epoch" --> ROOTS
  DASH --> VAULT & REG & ROOTS & GW & KEEP
```

| Component | Code | Role |
|---|---|---|
| `MockUSDC` | `contracts/src/MockUSDC.sol` | 6-decimal settlement token with ERC-2612 permit and an open faucet (1,000 per call). |
| `PlanRegistry` | `contracts/src/PlanRegistry.sol` | Providers publish plans. Price, period, grace, token and payee have no setter. `active` only gates new subscriptions. |
| `SubscriptionVault` | `contracts/src/SubscriptionVault.sol` | Holds subscriptions and claimable balances. Anyone may call `charge`. The vault decides the amount (always `price`) and the timing (anchored schedule). |
| `UsageRootRegistry` | `contracts/src/UsageRootRegistry.sol` | Allow-listed committers post one Merkle root per (plan, epoch). Anyone can verify a row; `hashRow` recomputes the leaf on-chain. |
| Keeper | `keeper/` | Polls `dueSubscriptions`, sends `chargeBatch`, logs JSONL, serves `/health` on :8788. It is stateless and permissionless, and many can run at once. |
| Gateway | `gateway/` | SIWE auth, `csk_` API keys, entitlement gate (402), policy (model allowlist, `max_tokens` cap, rate limit, live budget), AIPG proxy (mock/live), SQLite metering, epoch roots, proof API. |
| Dashboard | `dashboard/` | Next.js UI: overview, provider, plan/subscribe, chat, activity, attack panel, epoch verifier. |
| Shared | `packages/shared/` | Generated ABIs and `addresses.json` (31337, 84532). This is the only place addresses live. |

## Subscription state machine

```mermaid
stateDiagram-v2
  [*] --> Active: subscribe / subscribeWithPermit<br/>(first period paid now)
  Active --> Active: charge OK<br/>nextChargeAt += period
  Active --> PastDue: charge fails (balance/allowance)<br/>and now < nextChargeAt + grace
  PastDue --> Active: charge OK (top-up within grace)
  PastDue --> PastDue: charge fails again within grace
  Active --> Lapsed: charge fails and now ≥ nextChargeAt + grace
  PastDue --> Lapsed: charge fails and now ≥ nextChargeAt + grace
  Active --> Cancelled: cancel (subscriber)
  PastDue --> Cancelled: cancel (subscriber)
  Lapsed --> [*]
  Cancelled --> [*]
```

Entitlement is computed from that state on every read:

```
isEntitled = (Active or PastDue) and now < nextChargeAt + grace
          or  Cancelled          and now < nextChargeAt        (paid-through, no grace)
```

## One period, end to end

```mermaid
sequenceDiagram
  autonumber
  participant S as Subscriber
  participant V as SubscriptionVault
  participant K as Keeper (anyone)
  participant G as Gateway
  participant A as AIPG
  participant R as UsageRootRegistry
  S->>V: subscribeWithPermit(plan, 12×price, sig)
  V->>V: try permit (front-run tolerant), pull price, nextChargeAt = now + period
  S->>G: SIWE sign-in → JWT
  S->>G: POST /v1/chat/completions
  G->>V: entitledSubOf(wallet, plan) (cached 15 s)
  G->>A: forward (max_tokens ≤ 256)
  A-->>G: SSE stream (+ usage)
  G-->>S: SSE stream (unchanged bytes)
  G->>G: insert usage row (hashes, tokens, TTFT)
  Note over K,V: time passes, nextChargeAt reached
  K->>V: dueSubscriptions(cursor, 500)
  K->>V: chargeBatch(ids)
  V->>V: pull exactly price, credit payee (price − fee) + keeper fee, nextChargeAt += period
  Note over G,R: epoch closes (EPOCH_SECONDS)
  G->>G: StandardMerkleTree over the epoch's rows
  G->>R: commitRoot(plan, epoch, root, rows, tokens, uri)
```

## Keeper loop

```mermaid
flowchart TD
  T([every TICK_SECONDS]) --> P["page dueSubscriptions(cursor, 500)<br/>until nextCursor = 0"]
  P --> F{"any due ids not already<br/>failed this tick?"}
  F -- no --> W([sleep])
  F -- yes --> C[chunk into BATCH_SIZE]
  C --> S["simulateContract(chargeBatch)"]
  S --> X["send tx, wait for receipt"]
  X --> L["parse Charged / ChargeFailed / SubscriptionLapsed<br/>append JSONL: scheduledAt, executedAt, drift, gas"]
  L --> R{"round < maxRounds?<br/>(catch-up after outage)"}
  R -- yes --> P
  R -- no --> W
```

A keeper that was offline re-scans within the same tick. Each charge settles exactly one period (anchored), so a subscription that is k periods behind is charged k times, one period per call, never `k × price` in one call. Subscriptions that failed in this tick (PastDue) are not retried until the next tick.

## Trust assumptions

| Party | Trusted for | Not trusted for (enforced on-chain) |
|---|---|---|
| Keeper | Liveness only. If no keeper runs, charges are late, not lost (and unfunded subs lapse). | Amount, timing, recipient. It cannot charge early, twice, after cancel, more than `price`, or redirect funds. |
| Gateway | Correct metering and honest root commitments. It also gates access to its own AIPG key. | Payments. It cannot move funds. Roots only bind the gateway to what it recorded. |
| Provider | Delivering the service behind the plan. | Changing price/period/payee after subscribers enrol. It can only close the plan to new subscribers. |
| Subscriber | Keeping balance and allowance if they want service. | Nothing else. They can cancel at any time and keep access until paid-through. |
| Token | Standard ERC-20 behaviour. | `SafeERC20` handles non-standard return values. Fee-on-transfer tokens are not supported. |

See `docs/REPORT_NOTES.md` for the full threat model and limitations.
