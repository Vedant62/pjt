# Cashew

Decentralized recurring (subscription) payments on EVM chains. A provider publishes a plan on-chain, a subscriber signs **one** EIP-712 permit to enrol, and an **untrusted, permissionless keeper** triggers each charge when it falls due. The contract, not the allowance, enforces the limit: **at most the plan price, at most once per elapsed period**.

The demo use case is paid access to [AI Power Grid](https://api.aipowergrid.io), a decentralized inference network with an OpenAI-compatible API. The **Cashew Gateway** lets a wallet use the API only while its on-chain subscription is entitled. It meters every request and commits a Merkle root of usage rows on-chain each epoch.

- Spec: [SPEC.md](SPEC.md) · Status: [PROGRESS.md](PROGRESS.md) · Results: [results/RESULTS.md](results/RESULTS.md)
- Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Demo: [docs/DEMO.md](docs/DEMO.md) · Report notes: [docs/REPORT_NOTES.md](docs/REPORT_NOTES.md)

## Prerequisites

- Node ≥ 20 and pnpm 9
- Foundry (`forge`, `anvil`, `cast`): `foundryup`, or `brew install foundry`
- Python 3 (for plots only; `pnpm results:summary` creates a venv in `sim/.venv`)

```bash
pnpm i
```

## Local demo (anvil + mock AIPG, no credits, no keys)

```bash
pnpm local:up
```

This starts a fresh anvil (1 s blocks), deploys and seeds the contracts, syncs ABIs into `packages/shared`, and starts the keeper (:8788), the gateway in mock mode (:8787) and the dashboard (http://localhost:3000). Port 3000 busy? Use `DASHBOARD_PORT=3001 pnpm local:up`.

In the dashboard, **Connect Wallet → "Local anvil"** offers burner wallets backed by the public anvil test keys: *#0 provider*, *#3 subscriber*, *#4 subscriber 2*, *#5 attacker*. No browser extension is needed. MetaMask works too (import those keys, add network `http://127.0.0.1:8545`, chain 31337).

Skip ahead one period: `cast rpc evm_increaseTime 180 && cast rpc evm_mine`.

## Tests

```bash
pnpm test:contracts                       # unit + fuzz + invariant (forge test -vvv)
cd contracts && forge coverage --no-match-coverage '(^|/)(test|script)/'
pnpm test:gateway                         # gateway e2e against a running local chain (pnpm local:up)
pnpm typecheck
```

## Testnet (Base Sepolia)

1. `cp contracts/.env.example contracts/.env` and set `PRIVATE_KEY` (deployer), `ETHERSCAN_API_KEY` (Etherscan v2), `GATEWAY_ADDRESS` (the gateway's committer wallet) and `SUBSCRIBER_ADDRESSES`. Fund the deployer, keeper and gateway with Base Sepolia ETH.
2. Deploy, seed, verify on BaseScan, and sync addresses:
   ```bash
   pnpm deploy:testnet
   ```
3. `cp keeper/.env.example keeper/.env` and `cp gateway/.env.example gateway/.env`. Set `RPC_URL=https://sepolia.base.org` and `CHAIN_ID=84532`, plus the keeper/gateway keys and a long random `JWT_SECRET`. Leave `AIPG_MODE=mock` until you are ready to spend credits.
4. Run keeper + gateway + dashboard against Base Sepolia:
   ```bash
   pnpm testnet:up
   ```

### Live AIPG

Set `AIPG_MODE=live` and `AIPG_API_KEY` in `gateway/.env`. Live mode always caps `max_tokens` at 256, rate-limits each wallet to 10 req/min, and refuses with 503 after `AIPG_MAX_LIVE_REQUESTS` (default 150) total. The counter is persisted, so restarts do not reset it.

## Experiments

```bash
pnpm results:local      # test_summary, gas_report, batch_sweep, cost_model, schedule_sim, keeper_outage (≈30 min; schedule sim dominates)
pnpm results:testnet    # lifecycle_testnet, grid_snapshot, gateway_bench (asks before live calls; ≤ 30 requests), epochs
pnpm results:summary    # figures + results/RESULTS.md
```

Every number in `results/` is written by a script that ran. Values that could not be measured appear as `null`, with the reason in `RESULTS.md`.

## Layout

```
contracts/       Foundry: MockUSDC, PlanRegistry, SubscriptionVault, UsageRootRegistry + tests + scripts
packages/shared/ generated ABIs + addresses.json (31337, 84532) — the only place addresses live
keeper/          permissionless keeper service (Node/TS, viem)
gateway/         entitlement gateway, metering, epoch roots (Express, SQLite, merkle-tree)
dashboard/       Next.js 14 + wagmi + RainbowKit
sim/             experiments, benchmarks, plots
results/         machine-written results + RESULTS.md
docs/            architecture, demo runbook, report notes
```
