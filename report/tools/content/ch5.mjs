import { code, fig, h2, h3, p, ul, table } from "./dsl.mjs";

export default {
  title: "Implementation",
  blocks: [
    h2("Repository Structure"),
    p("The implementation is a single pnpm monorepo. Contracts are a Foundry project, and every off-chain package imports contract ABIs and deployed addresses from one generated package, so no address is hard-coded anywhere else. Listing 5.1 shows the layout."),
    code(`cashew/
├─ contracts/            Foundry project
│  ├─ src/               MockUSDC, PlanRegistry, SubscriptionVault, UsageRootRegistry
│  ├─ test/              unit, fuzz and invariant (handler-based) tests
│  ├─ script/            Deploy.s.sol, Seed.s.sol
│  └─ deployments/       <chainId>.json written by the deploy scripts
├─ packages/shared/      generated ABIs + addresses.json keyed by chainId (31337, 11155111, 84532)
├─ keeper/               permissionless keeper service (Node.js, TypeScript, viem)
├─ gateway/              entitlement gateway, metering, epoch roots (Express, SQLite)
├─ dashboard/            Next.js 14 App Router + wagmi + RainbowKit + Tailwind
├─ sim/                  experiments and benchmarks; plots.py
├─ results/              machine-written results (JSON) and RESULTS.md
└─ scripts/              local-up, deploy-testnet, testnet-up orchestrators`, "Listing 5.1  Repository layout"),
    h2("Smart Contracts"),
    h3("MockUSDC"),
    p("The settlement token extends OpenZeppelin's ERC20 and ERC20Permit with six decimals, like USDC. A `mint` function open to anyone, capped at 1,000 tokens per call, serves as the testnet faucet for the dashboard's “Get test mUSDC” button."),
    h3("PlanRegistry"),
    p("Plans are stored in an array with ids starting at 1, so 0 can mean “none”. `createPlan` validates its inputs with custom errors (`ZeroAddress`, `ZeroPrice`, `ZeroPeriod`, `GraceNotLessThanPeriod`) and emits `PlanCreated`. The only mutator is `setPlanActive`, restricted to the plan's provider. A `getPlanTerms` view returns the economic fields without the metadata string, so the vault can read terms without copying a string across contracts."),
    h3("SubscriptionVault"),
    p("The vault implements the algorithm of Section 4.4 using OpenZeppelin's `SafeERC20` and `ReentrancyGuard`. Two implementation choices matter for cost. Because plan terms are immutable, the vault caches them on first use in its own storage (two packed slots) instead of calling the registry on every charge. And all status checks and schedule updates happen before the external `transferFrom`, following the checks-effects-interactions order. Errors are custom errors carrying their context, for example `NotChargeable(Status)` and `AlreadySubscribed(subId)`. This is what lets the dashboard's attack panel decode and display the exact reason for each revert. A wallet may hold at most one live subscription per plan. `latestSubOf` exposes the most recent one so the gateway can report its status even when it is no longer entitled."),
    code(`function subscribeWithPermit(uint256 planId, uint256 permitValue, uint256 deadline,
                             uint8 v, bytes32 r, bytes32 s) external nonReentrant returns (uint256) {
    Terms memory t = _loadTerms(planId);
    // A permit copied from the mempool and submitted first must not block enrolment.
    try IERC20Permit(t.token).permit(msg.sender, address(this), permitValue, deadline, v, r, s) {} catch {}
    return _subscribe(planId, t);
}`, "Listing 5.2  Front-run-tolerant enrolment (excerpt of SubscriptionVault.sol)"),
    h3("UsageRootRegistry"),
    p("This Ownable registry keeps an allow-list of committers and stores one record per (plan, epoch): root, row count, total tokens, commit time, committer and a URI where the tree can be fetched. A second commit for the same epoch reverts with `RootAlreadyCommitted`. `verifyRow` checks a proof with OpenZeppelin's `MerkleProof`, and `hashRow` recomputes the StandardMerkleTree leaf of a usage row on-chain."),
    h2("Deployment"),
    p("`Deploy.s.sol` deploys the four contracts with a keeper fee of 25 basis points, authorises the gateway's address as root committer, and writes the addresses and start block to `deployments/<chainId>.json`. `Seed.s.sol` creates the two plans used throughout the project and mints test tokens to the subscriber wallets. The **demo plan** costs 20 mUSDC with a 180-second period and 60-second grace, so a lifecycle can be shown live in minutes. The **production-shaped plan** costs 20 mUSDC with a 30-day period and 3-day grace. A sync script then regenerates the shared ABI and address package."),
    p("The contracts were deployed to **Ethereum Sepolia** and source-verified on Etherscan (Figure 5.1). Deployment showed that Sepolia's current fork prices contract creation far above the cancun schedule that local simulation assumes. Creation receipts were 6.53 M gas for MockUSDC and 11.65 M gas for SubscriptionVault. Forge's locally simulated gas limits therefore ran out of gas twice. The deploy script now passes `--skip-simulation`, so gas limits come from the node's own `eth_estimateGas`. The whole deployment and seeding cost about 0.0000000006 ETH at the prevailing gas price of roughly 19 wei."),
    fig("shots/10-etherscan-vault.png", "SubscriptionVault source verified on Sepolia Etherscan (exact match)", { width: 6.2 }),
    h2("Keeper Service"),
    p("The keeper is a class around two viem clients, one for reads and one for signing. Its `tick()` method implements the loop of Figure 4.3, and a small HTTP server exposes `/health` with the last tick, the current queue size and the keeper's own claimable fee balance. Every processed subscription produces one JSON line: scheduled time, block time of execution, drift, outcome, transaction hash, gas used and batch size. On SIGTERM or SIGINT the keeper finishes the transaction in flight and exits cleanly. The outage experiment in Chapter 6 depends on this. Configuration (RPC URL, chain id, key, tick interval, batch size) comes from environment variables. The tick is 15 seconds for the demo profile and 6 hours for the production profile."),
    h2("Cashew Gateway"),
    p("The gateway is an Express application whose endpoints are listed in Table 5.1. SIWE messages are parsed and verified with viem's EIP-4361 implementation: domain, chain id, single-use nonce and signature are all checked. The usage store is a single SQLite file holding usage rows, hashed API keys, committed epochs and the persisted live-request counter. In live mode the gateway enforces the caps described in Section 4.7. In mock mode it never touches the network."),
    table("Gateway HTTP endpoints", ["Endpoint", "Purpose"], [
      ["GET /auth/nonce, POST /auth/verify", "Sign-In With Ethereum → one-hour JWT bound to the wallet"],
      ["POST /keys", "Mint a csk_ API key for the signed-in wallet (JWT only; only the hash is stored)"],
      ["POST /v1/chat/completions", "OpenAI-compatible chat, streaming or not; 402 when not entitled"],
      ["GET /v1/models", "Allow-listed models, enriched with availability from AIPG in live mode"],
      ["GET /epochs, /epochs/:e/rows, /epochs/:e/tree", "Committed epochs, their rows and the stored Merkle tree"],
      ["GET /epochs/:e/proof/:rowId", "Leaf values, leaf hash and Merkle proof for one usage row"],
      ["GET /health", "Mode, remaining live budget, last committed epoch, cache size"],
    ], [2.6, 3.9]),
    h2("Integration with AI Power Grid"),
    p("The project uses AIPG's public hosted API, not a self-hosted coordinator. To make the grid's supply side part of the demonstration, the team pulled the open-weight `qwen3` models with Ollama on its own GPU and ran the AIPG worker binary. The worker's setup wizard was used to bind the worker to the team's Grid account. The coordinator confirms a worker by routing a canary job to it, after which `GET /v1/workers` lists it as online. The worker list taken during the evaluation (Chapter 6) shows the team's qwen3 workers online alongside community workers. On the demand side, the gateway holds a single platform API key and meters usage per subscriber itself, because AIPG keys are per account rather than per end user."),
    h2("Dashboard"),
    p("The dashboard is a Next.js application using wagmi and RainbowKit for wallet connection. It reads all contract state directly from the chain through the shared ABIs. Every transaction hash and address links to the block explorer of the connected chain. The screenshots in this section were captured from the dashboard running against the Sepolia deployment, with real transactions."),
    h3("Overview and provider pages"),
    p("The overview page (Figure 5.2) shows the deployed contract addresses, the live health of the keeper and the gateway, live counters derived from on-chain events, and the list of plans. The provider page (Figure 5.3) creates plans, lists the provider's own plans with subscriber counts, opens or closes them, and withdraws revenue."),
    fig("shots/01-overview.png", "Overview page on Sepolia: contracts, keeper and gateway health, counters and plans", { width: 6.2 }),
    fig("shots/02-provider.png", "Provider page: plan creation, own plans and revenue withdrawal", { width: 6.2 }),
    h3("Plan and subscription page"),
    p("The plan page (Figure 5.4) shows the immutable terms. It lets a subscriber mint test tokens and enrol with one permit signature and one transaction, and shows the live subscription card: status, entitlement, a countdown to the next charge, charge count and remaining allowance cycles. It also carries the cancel, re-approve and (for demonstrations) drain-balance actions."),
    fig("shots/03-plan.png", "Plan page with an active, entitled subscription after ten charges", { width: 6.2 }),
    h3("Chat page and the 402 path"),
    p("The chat page signs in with SIWE, lists the allow-listed models, and streams a completion through the gateway, showing time to first token, total time and token counts under each reply (Figure 5.5). qwen3 streams its reasoning separately from its answer, and the page renders the reasoning in a muted block. When the connected wallet has no entitled subscription, the gateway's 402 response is rendered as a banner carrying the on-chain status and a link to the plan (Figure 5.6)."),
    fig("shots/04-chat.png", "Live chat with qwen3:8b on AI Power Grid through the gateway (reasoning shown muted)", { width: 6.2 }),
    fig("shots/05-chat-402.png", "HTTP 402 Payment Required for a wallet with no subscription", { width: 6.2 }),
    h3("Activity, attack panel and epoch verifier"),
    p("The activity page (Figure 5.7) is a live feed of protocol events, showing each keeper charge's drift from its scheduled time. The attack panel (Figure 5.8) runs the five keeper attacks of Table 4.4 from an outsider wallet. Each attack is simulated against the chain and the decoded custom error is displayed. An optional switch broadcasts the reverting transaction so it can be inspected on the explorer. The epoch verifier is described with the results in Chapter 6."),
    fig("shots/06-activity.png", "Activity feed: subscriptions, keeper charges with drift, failure, cancellation and usage roots", { width: 6.2 }),
    fig("shots/07-attacks.png", "Attack panel: all five attacks rejected by the contract with decoded errors", { width: 5.6, maxH: 8.4 }),
    h2("Local Development Stack"),
    p("`pnpm local:up` starts a fresh anvil chain with one-second blocks, deploys and seeds the contracts with the public anvil test keys, regenerates the shared package, and starts the keeper, the gateway in mock mode and the dashboard. For the local demonstration the dashboard offers anvil-only burner wallets, so the full flow runs without a browser extension. These wallets are disabled for public networks. The same orchestration pattern (`pnpm testnet:up`) runs the keeper, the gateway and the dashboard against Sepolia."),
  ],
};
