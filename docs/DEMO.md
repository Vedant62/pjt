# Live demo runbook (8–10 minutes)

Target: Ethereum Sepolia (11155111) + live AIPG. **Fallback: local anvil + mock AIPG** (see the end). If you fall back, say so out loud.

Roles and wallets (browser profiles or MetaMask accounts):

| Role | Wallet | Needs |
|---|---|---|
| Provider / payee | deployer `0xdb0C…62E7` | a little Sepolia ETH |
| Subscriber | subscriber test wallet | ~0.001 ETH; mUSDC from the in-app faucet |
| Attacker | any third wallet | ~0.001 ETH (only for "send for real") |
| Keeper | `keeper/.env` key | ~0.005 ETH |
| Gateway | `gateway/.env` key (committer) | ~0.005 ETH |

## Pre-flight (T−15 min)

- [ ] `pnpm testnet:up` is running. The Overview shows **Keeper ● healthy** and **Gateway ● healthy**.
- [ ] Gateway `/health`: `mode: "live"`, `liveBudget.remaining` ≥ 20 (`curl localhost:8787/health`).
- [ ] Our worker is online: `curl -s https://api.aipowergrid.io/v1/workers | jq '.[] | select(.name|test("<our worker>"))'`.
- [ ] Wallet balances: subscriber, keeper and gateway each hold ≥ 0.002 Sepolia ETH (`cast balance <addr> --ether --rpc-url https://ethereum-sepolia-rpc.publicnode.com`).
- [ ] The subscriber has **no** live subscription to plan 1 (cancel any leftover on `/plans/1`).
- [ ] Two browser windows: subscriber (left) and attacker (right). Etherscan open in a tab.
- [ ] `EPOCH_SECONDS=300` in `gateway/.env`, so a root lands during the talk.

## Script

**0:00 — 1. Deployed and verified contracts.** On `/`, the four contract addresses link to Etherscan. Open `SubscriptionVault` and show the green "verified" tick. Say: *"Price, period and payee live in PlanRegistry with no setter. Charging is open to anyone, but the vault decides the amount and the timing."*

**0:45 — 2. Provider plan.** On `/provider`, show the form and the seeded **AI Power Grid Access — demo cadence** plan: 20 mUSDC, period 3 min, grace 1 min. Optionally create a plan live (one tx).

**1:30 — 3. Subscribe with one signature.** Subscriber window, `/plans/1`: **Get test mUSDC** (one tx), then **Subscribe**. Point out the single EIP-712 permit signature followed by one transaction. The card shows **Active**, entitled **yes**, a countdown, and **11 cycles** of allowance left. Say: *"The permit allows 12 cycles, but the vault can still only pull 20 per period."*

**2:30 — 4. Chat through the gateway.** `/chat` → **Sign in** (SIWE, no tx) → pick `qwen3:8b` → ask something short. Show TTFT, token counts and the grid job id under the reply. In a terminal: `curl -s https://api.aipowergrid.io/v1/workers | jq` and point to our worker.

**4:00 — 5. The keeper charges with no human in the loop.** `/activity`: within 3 minutes of subscribing a **Charged** row appears, showing the keeper address and drift in seconds. Click the tx through to Etherscan. On `/plans/1` the charge count goes up by one.

**5:00 — 6. Attack panel.** Attacker window, `/attacks`. Click all five **Run attack** buttons. Each shows ✓ Blocked plus the decoded error (`NotDue()`, `NotDue()`, `NotChargeable(4)`, `ERC20InsufficientAllowance(…)`, `NothingToWithdraw()`). Tick **Send for real** and rerun #1 to show a failed tx on Etherscan. *(#3 needs a cancelled subscription. If none exists yet, run it after step 8.)*

**6:15 — 7. Payment failure and recovery.** Subscriber `/plans/1`: **Drain balance (demo)**. At the next due time the keeper's charge emits **ChargeFailed (balance)** and the status becomes **PastDue**, but it stays entitled during the 60 s grace. Chat still works. After grace, chat returns the red **402 Payment Required** banner with status PastDue. Click **Go to plan** → **Get test mUSDC**. The next keeper tick recovers it to **Active** and chat works again.
  *If timing is tight:* show the PastDue state and the 402 in the activity feed, then top up.

**8:00 — 8. Cancel.** **Cancel** → status **Cancelled**, entitled **yes (paid through)** with a countdown. Chat still works until the countdown ends, then returns 402 with status Cancelled.

**9:00 — 9. Usage roots.** `/epochs`: pick the latest committed epoch → pick a row from our chats → **Fetch proof & verify on-chain** → ✓. Tick **Tamper** → ✗. Say: *"The root proves what the gateway recorded. It doesn't prove the gateway was honest. That limitation is stated in the report."*

## Fallback: local stack (RPC or AIPG down)

1. Say: *"The testnet RPC / AI Power Grid is unavailable right now, so I'm switching to the identical local stack: anvil with mock inference."*
2. `pnpm local:up` (≈30 s). Open `http://localhost:3000`.
3. Connect with the built-in **Local anvil** wallets: *Anvil #0 · provider*, *Anvil #3 · subscriber*, *Anvil #5 · attacker*. No extension is needed.
4. Run the same script. Differences: chat replies are canned mock text (marked as mock, no credits spent), and tx links show hashes instead of Etherscan links. One cancelled subscription is pre-seeded, so attack #3 works immediately.
5. To skip waiting for a period: `cast rpc evm_increaseTime 180 && cast rpc evm_mine`.

If only AIPG is down, keep Sepolia and restart the gateway with `AIPG_MODE=mock`.
