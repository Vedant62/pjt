import { code, eq, fig, h2, h3, p, ul, table } from "./dsl.mjs";

export default {
  title: "System Design",
  blocks: [
    h2("Architectural Overview"),
    p("Cashew is organised into two planes (Figure 4.1). The **subscription plane** is on-chain. Four contracts hold every unit of value and enforce every payment rule. The **service plane** is off-chain. A keeper supplies the clock, a gateway sells metered access to AI Power Grid, and a dashboard presents the state to people. Two kinds of chain write bracket each period: the keeper's charge at the start and the gateway's usage root at the end. Everything in between is ordinary API traffic. Off-chain components hold no custody. The keeper can only ask the vault to do what the vault already permits, and the gateway can only commit roots, never move funds."),
    fig("diagrams/architecture.png", "System architecture: participants, off-chain services, on-chain contracts and the AI Power Grid", { width: 6.3 }),
    table("Modules and responsibilities", ["#", "Module", "Responsibility", "Implemented in"], [
      ["1", "Plan registry", "Publish plans with immutable economic terms; open or close to new subscribers", "PlanRegistry.sol"],
      ["2", "Subscription vault", "Enrol, charge on an anchored schedule, cancel, account balances, entitlement views", "SubscriptionVault.sol"],
      ["3", "Open keeper market", "Discover due subscriptions, charge in batches, earn the fee", "SubscriptionVault.chargeBatch + keeper/"],
      ["4", "One-signature consent", "EIP-712 / ERC-2612 permit inside subscribe; front-run tolerant", "subscribeWithPermit + MockUSDC"],
      ["5", "Gateway", "SIWE auth, API keys, entitlement gate (402), policy, AIPG proxy", "gateway/"],
      ["6", "Metering and commitments", "Usage rows, per-epoch Merkle roots, proofs, on-chain verification", "gateway/ + UsageRootRegistry.sol"],
      ["7", "Dashboard", "Provider, plan, chat, activity, attack panel, epoch verifier", "dashboard/"],
    ], [0.3, 1.5, 3.1, 1.8], { size: 19 }),
    h2("Data Model"),
    p("A plan and a subscription are the only two records the protocol needs. A plan's economic fields are written once at creation and have no setter. A subscription binds a wallet to a plan and carries the schedule and status. Both structures are packed to minimise storage slots: a subscription occupies two 32-byte slots."),
    code(`struct Plan {
    address provider;     // msg.sender at creation
    address payee;        // receives revenue; immutable
    address token;        // ERC-20 settlement token; immutable
    uint96  price;        // per-period price in token units; immutable
    uint32  period;       // seconds; immutable; > 0
    uint32  gracePeriod;  // seconds; immutable; must be < period
    bool    active;       // provider may close to NEW subscriptions only
    string  metadataURI;  // name, description, features
}
enum Status { None, Active, PastDue, Lapsed, Cancelled }
struct Subscription {
    address subscriber;
    uint64  planId;
    uint64  startedAt;
    uint64  nextChargeAt;  // anchored: advances by exactly one period per charge
    uint64  pastDueSince;  // 0 unless PastDue
    uint32  chargeCount;   // includes the payment taken at subscribe time
    Status  status;
}`, "Listing 4.1  Plan and subscription records"),
    p("Balances owed to payees and keepers are kept in a mapping `claimable[account][token]`. Funds pulled from subscribers stay in the vault until the entitled account withdraws them. This pull-payment pattern keeps every transfer out of the vault limited to the caller's own balance."),
    h2("Subscription State Machine"),
    p("Figure 4.2 shows the lifecycle. A subscription starts Active with its first period already paid. A due charge that succeeds keeps it Active and moves `nextChargeAt` forward by exactly one period. A charge that fails for lack of balance or allowance moves it to PastDue if the grace window is still open, recording when the unpaid period began. A later successful charge returns it to Active. If a charge still cannot be collected once grace has ended, the subscription becomes Lapsed. Cancelled and Lapsed are terminal states. A subscriber may then start a fresh subscription to the same plan."),
    fig("diagrams/states.png", "Subscription state machine", { width: 6.2 }),
    h3("Entitlement"),
    p("Whether a wallet should receive service is computed from the state on every read, never stored:"),
    eq("isEntitled = (status ∈ {Active, PastDue} ∧ now < nextChargeAt + grace) ∨ (status = Cancelled ∧ now < nextChargeAt)"),
    p("Three consequences follow. A late keeper does not cut access, because Active subscriptions remain entitled during grace even if nobody has charged them yet. A failed payment cuts access once grace ends, even before any keeper records the lapse. And a cancelled subscription keeps exactly the time it has paid for, with no grace."),
    h2("Charging Algorithm"),
    p("The charge function is open to every address. Its safety does not come from restricting the caller. It comes from the vault deciding both the amount and the timing itself. Listing 4.2 gives the algorithm."),
    code(`charge(subId):
    s ← subs[subId]
    require s.status ∈ {Active, PastDue}            else revert NotChargeable(s.status)
    require now ≥ s.nextChargeAt                    else revert NotDue()
    t ← terms[s.planId]                             // immutable, cached from PlanRegistry
    if balance(s.subscriber) < t.price  → reason ← 1
    elif allowance(s.subscriber, vault) < t.price → reason ← 2
    if reason ≠ 0:
        if now ≥ s.nextChargeAt + t.grace: s.status ← Lapsed; emit SubscriptionLapsed; return
        if s.status ≠ PastDue: s.status ← PastDue; s.pastDueSince ← s.nextChargeAt
        emit ChargeFailed(subId, reason); return       // no revert, no fee
    s.nextChargeAt ← s.nextChargeAt + t.period       // effects first (CEI)
    s.chargeCount ← s.chargeCount + 1; s.status ← Active; s.pastDueSince ← 0
    fee ← t.price × keeperFeeBps / 10 000
    transferFrom(s.subscriber → vault, t.price)
    claimable[t.payee] += t.price − fee; claimable[msg.sender] += fee
    emit Charged(subId, planId, t.price, fee, msg.sender, s.nextChargeAt)`, "Listing 4.2  Charging algorithm"),
    h3("Anchored schedule"),
    p("The schedule advances from the previous due time, not from the time of the call. If the subscription started at time t₀ with period P, then after k keeper charges:"),
    eq("nextChargeAt = t₀ + (k + 1) · P"),
    p("A keeper that is an hour late therefore does not move the billing date by an hour. A keeper that returns after missing several periods settles them one call at a time, and each call collects exactly one period. Because grace is shorter than the period, a subscription that cannot pay lapses at the first attempt after grace instead of accumulating debt. The total ever collected from a subscriber is bounded by"),
    eq("collected ≤ price · (1 + ⌊(now − t₀) / P⌋)"),
    p("which is invariant I1 in Section 4.10."),
    h3("Batching and due enumeration"),
    p("`chargeBatch(ids)` applies the same per-subscription logic to up to 200 ids in one transaction. Ids that are not chargeable or not yet due are counted as skipped rather than reverting, so one bad id cannot block the rest. Keepers find work through `dueSubscriptions(cursor, limit)`, a view that scans a bounded window of ids and returns those that are due, with a cursor for the next page. This bounds the cost of each call regardless of how many subscriptions exist."),
    h3("Keeper incentive"),
    p("The keeper's reward is a fixed fraction of the price, `keeperFeeBps = 25` (0.25 %), credited to `msg.sender` only on a successful charge. A failed or skipped charge earns nothing, so a keeper is never paid for spam. On a 20 USD plan the reward is 0.05 USD per charge. Whoever does the work earns it, with no registration, which is what makes the keeper an open market."),
    h2("One-Signature Enrolment"),
    p("`subscribeWithPermit(planId, value, deadline, v, r, s)` first calls the token's ERC-2612 `permit` inside a try/catch block, then performs the normal subscription. The subscriber signs a permit for twelve periods (`12 × price`) so that the vault can collect a year of renewals without another signature, but the vault still never pulls more than one price per elapsed period. The try/catch matters because a signed permit is visible in the mempool. If an observer submits the permit first (front-running, see Daian et al., 2020), the subscriber's own transaction would otherwise revert. With the try/catch, enrolment succeeds as long as the resulting allowance is sufficient."),
    h2("Keeper Service Design"),
    p("The keeper (Figure 4.3) is a stateless loop. At each tick it pages through `dueSubscriptions`, splits the due ids into chunks of `BATCH_SIZE`, simulates and sends `chargeBatch` for each chunk, and parses the resulting events into one log line per subscription. Each line records the scheduled time, the block time of execution, the drift between them, the outcome and the gas used. Within a tick the keeper re-scans until nothing new is due, so a keeper returning from an outage catches up every missed period in one tick. Subscriptions that failed in the current tick are not retried until the next tick."),
    fig("diagrams/keeper.png", "Keeper loop", { width: 4.6, maxH: 6.6 }),
    h2("Gateway Design"),
    p("The gateway (Figure 4.4) is an OpenAI-compatible reverse proxy in front of AIPG. A wallet authenticates once with Sign-In With Ethereum (Chang et al., 2021) and receives a one-hour JSON Web Token, or mints a long-lived `csk_` API key whose SHA-256 hash is stored. API keys cannot mint further keys. For each request the gateway resolves the wallet and checks entitlement on-chain through `entitledSubOf`, cached in memory for 15 seconds. If the wallet is not entitled, it returns **HTTP 402 Payment Required** with the on-chain status, the subscription id and its `nextChargeAt`, so a client can explain why access stopped."),
    p("Entitled requests then pass a policy layer: a model allowlist, a cap of 256 on `max_tokens`, a limit of 10 requests per minute per wallet, and a global budget of live requests persisted in SQLite. The budget unit is reserved before the upstream call, so neither restarts nor concurrent requests can overspend the shared credit. The request is forwarded with the platform key. Streamed responses are passed through byte for byte while the gateway accumulates the generated text and the usage block. Upstream calls and a local mock share one code path: the mock returns a synthetic HTTP response with the same shape, so tests exercise the real streaming code."),
    fig("diagrams/gateway.png", "Gateway request pipeline", { width: 4.8, maxH: 7.0 }),
    h2("Metering and Usage Commitments"),
    p("Each request produces one usage row. Its leaf in the Merkle tree encodes nine fields with the Solidity ABI types shown in Table 4.2. `requestHash` is the Keccak-256 hash of the forwarded request serialised as canonical JSON (keys sorted). `responseHash` is the hash of the generated text, including any reasoning the model streamed. Every `EPOCH_SECONDS` (300 s in the demo) the gateway closes the epoch, builds a StandardMerkleTree over its rows, stores the tree, and calls `commitRoot(planId, epoch, root, rowCount, totalTokens, uri)`. Empty epochs are skipped. Anyone can later fetch a row's proof from the gateway and check it on-chain. The registry also exposes `hashRow`, so the leaf can be recomputed from the row's fields on-chain rather than trusted from the gateway (Figure 4.5)."),
    table("Usage-row leaf encoding", ["Field", "ABI type", "Meaning"], [
      ["epoch", "uint64", "floor(timestamp / EPOCH_SECONDS)"],
      ["wallet", "address", "Authenticated wallet"],
      ["subId", "uint256", "Entitled subscription that paid for the request"],
      ["model", "string", "Requested model, e.g. qwen3:8b"],
      ["promptTokens, completionTokens", "uint32, uint32", "Usage reported by the upstream"],
      ["requestHash, responseHash", "bytes32, bytes32", "Keccak-256 of request and response"],
      ["timestamp", "uint64", "Completion time (seconds)"],
    ], [2.2, 1.6, 2.7]),
    fig("diagrams/epochs.png", "Per-epoch usage commitment and verification", { width: 2.6, maxH: 6.0 }),
    h2("One Billing Period End to End"),
    p("Figure 4.6 shows the messages exchanged in one period. The subscriber signs exactly once, at enrolment. Every later period is opened by a keeper's charge and closed by the gateway's usage root, with no further action from the subscriber."),
    fig("figures/sequence.png", "Message sequence for one billing period", { width: 6.2 }),
    h2("Safety Properties"),
    p("The design's guarantees are stated as five invariants and five “keeper cannot” properties, each mapped to a named test (Chapter 6)."),
    table("Protocol invariants", ["Name", "Statement"], [
      ["I1 noOvercharge", "For every subscriber, total pulled ≤ Σ price × (1 + ⌊(now − startedAt) / period⌋) over its subscriptions"],
      ["I2 noChargeAfterTerminal", "No successful charge ever happens after a subscription is Cancelled or Lapsed"],
      ["I3 solvency", "Vault token balance = Σ claimable over all accounts"],
      ["I4 anchoredSchedule", "nextChargeAt = startedAt + period × chargeCount for every subscription"],
      ["I5 ownFundsOnly", "No account ever withdraws more than it was credited"],
    ], [1.9, 4.6]),
    table("What a keeper (or any caller) cannot do", ["Attack", "Why it fails"], [
      ["Charge early", "charge reverts NotDue() while now < nextChargeAt"],
      ["Charge twice in a period", "A successful charge moves nextChargeAt one period ahead, so a second call reverts NotDue()"],
      ["Charge a cancelled subscription", "Terminal status: NotChargeable(Cancelled)"],
      ["Pull more than the price", "The vault has no amount parameter. A direct transferFrom by the attacker fails with ERC20InsufficientAllowance, because the subscriber approved the vault, not the attacker"],
      ["Redirect the payee's funds", "withdraw pays only msg.sender's own balance (NothingToWithdraw), and neither contract has a payee setter"],
    ], [1.9, 4.6]),
    h2("Design Decisions"),
    table("Design decisions and their rationale", ["Decision", "Standard / prior art", "Reason"], [
      ["Settle in a USD stablecoin", "ERC-20; Mita et al. (2019); Pernice et al. (2019)", "A 20 USD plan is meaningless in a volatile unit"],
      ["One-signature enrolment", "EIP-712; ERC-2612", "The subscriber signs readable, typed terms once"],
      ["Per-period cap inside the contract", "ERC-948 discussion (Owocki, 2018)", "A standing allowance alone can be drained in one call"],
      ["Open, paid trigger", "Chainlink 2.0 (Breidenbach et al., 2021)", "Supplies the missing clock without granting authority over funds"],
      ["Batched charging", "BatPay (Mayer et al., 2020)", "Amortises the fixed cost per transaction"],
      ["Anchored schedule; grace < period", "This work", "Late keepers do not shift billing dates, and unpaid subscriptions lapse instead of accruing debt"],
      ["Failures as state transitions", "This work", "A batch never reverts on one subscriber, and keepers are not paid for failures"],
      ["Merkle root per epoch", "Merkle (1988); OpenZeppelin (2024)", "Verifiable usage at one transaction per epoch"],
      ["Discrete periods, not streams", "Meng & Feng (2025)", "Access is sold per period. Streaming complicates entitlement checks"],
    ], [1.8, 2.1, 2.6], { size: 19 }),
  ],
};
