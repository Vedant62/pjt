# Report notes

Working notes for the project report. Numbers live in `results/RESULTS.md` (machine-written) and are not repeated here, so they can't drift.

## 1. Contract interfaces as built

```solidity
// PlanRegistry
function createPlan(address token, uint96 price, uint32 period, uint32 gracePeriod, address payee, string metadataURI) returns (uint256 planId);
function setPlanActive(uint256 planId, bool active);                 // provider only
function getPlan(uint256 planId) view returns (Plan memory);
function getPlanTerms(uint256 planId) view returns (address payee, address token, uint96 price, uint32 period, uint32 gracePeriod, bool active); // ADDED
function planCount() view returns (uint256);
errors: ZeroAddress, ZeroPrice, ZeroPeriod, GraceNotLessThanPeriod(grace, period), UnknownPlan(id), NotProvider

// SubscriptionVault (keeperFeeBps immutable, = 25 in Deploy.s.sol; max 1,000)
function subscribeWithPermit(uint256 planId, uint256 permitValue, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256 subId);
function subscribe(uint256 planId) returns (uint256 subId);
function charge(uint256 subId);
function chargeBatch(uint256[] subIds) returns (uint256 ok, uint256 failed, uint256 skipped); // ≤ 200 ids
function cancel(uint256 subId);
function withdraw(address token);
function isEntitled(uint256 subId) view returns (bool);
function entitledSubOf(address subscriber, uint256 planId) view returns (uint256);
function latestSubOf(address subscriber, uint256 planId) view returns (uint256);     // ADDED
function getSubscription(uint256 subId) view returns (Subscription memory);
function claimable(address account, address token) view returns (uint256);
function dueSubscriptions(uint256 cursor, uint256 limit) view returns (uint256[] ids, uint256 nextCursor);
function subscriptionCount() view returns (uint256);
events: Subscribed(subId, planId, subscriber, amount, nextChargeAt), Charged(subId, planId, amount, fee, keeper, newNextChargeAt),
        ChargeFailed(subId, reason), SubscriptionLapsed(subId), Cancelled(subId, paidThrough), Withdrawn(account, token, amount)
errors: NotDue, NotChargeable(Status), NotSubscriber, NothingToWithdraw, PlanInactive(id), AlreadySubscribed(subId), BatchTooLarge(n), FeeTooHigh

// UsageRootRegistry (Ownable)
function setCommitter(address committer, bool allowed);              // owner
function commitRoot(uint256 planId, uint64 epoch, bytes32 root, uint64 rowCount, uint128 totalTokens, string uri); // committer, once per (plan, epoch)
function verifyRow(uint256 planId, uint64 epoch, bytes32[] proof, bytes32 leaf) view returns (bool);
function rootOf(uint256 planId, uint64 epoch) view returns (bytes32);
function getEpoch(uint256 planId, uint64 epoch) view returns (EpochRecord memory);   // ADDED
function hashRow(UsageRow row) pure returns (bytes32);                               // ADDED
errors: NotCommitter, ZeroRoot, RootAlreadyCommitted(planId, epoch)
```

## 2. Deviations from SPEC.md, and why

| # | Deviation | Why |
|---|---|---|
| D1 | Added `PlanRegistry.getPlanTerms` | Lets the vault read terms without copying the metadata string, which saves gas. Purely additive. |
| D2 | Vault caches plan terms on first use (`_terms[planId]`) | Terms are immutable, so caching is safe and turns an external call into two SLOADs per charge. `active` is still read live at subscribe time. |
| D3 | Added `latestSubOf` | The gateway's 402 body must report the on-chain status and subId even when `entitledSubOf` returns 0. |
| D4 | Added `UsageRootRegistry.getEpoch` and `hashRow` | `hashRow` lets anyone (and the dashboard) recompute a StandardMerkleTree leaf on-chain. The gateway e2e test checks JS leaf == Solidity leaf. |
| D5 | `createPlan` rejects `price == 0` and zero addresses | A zero price makes the fee arithmetic and the attack properties vacuous. |
| D6 | `cancel` on a non-live sub reverts `NotChargeable(status)` | The spec didn't define this case. Reusing the existing error keeps the ABI small. |
| D7 | The initial payment counts as charge #1 (`chargeCount = 1` after subscribe) | This makes I4 (`nextChargeAt == startedAt + period × chargeCount`) and the fuzz property (`startedAt + (k+1)·period` after k keeper charges) hold at the same time. |
| D8 | Status check before due check in `charge` | A cancelled sub reverts `NotChargeable(Cancelled)` even before its due time. That is more informative for the attack panel. Both errors still occur exactly as specified. |
| D9 | SIWE uses viem's EIP-4361 implementation (`viem/siwe`, `verifySiweMessage`) instead of the `siwe` npm package | The `siwe` package needs an ethers peer dependency. viem is already used everywhere and also supports ERC-6492 smart-account signatures. |
| D10 | Batch gas sweep uses real anvil transactions (`sim/src/batch-sweep.ts`); `GasSweep.s.sol` is a pointer | A forge-script simulation keeps storage warm across top-level calls and omits intrinsic and calldata gas, so it under-reports keeper cost. Receipts are the honest number. |
| D11 | `results/gas_report.*` is generated from unit tests only | Fuzz inputs and invariant-handler calls skew min/avg/max. Receipt gas is reported separately. |
| D12 | Node 22 used for development (spec: Node 20) | It was the installed version. Nothing uses Node-22-only APIs; `engines` says ≥ 20. |
| D13 | Foundry installed via Homebrew (1.8.5) | The `foundryup` download was blocked by the sandbox network policy. |
| D14 | matplotlib 3.10.7 (not 3.9) | 3.9 fails on Python 3.14 (infinite recursion in `deepcopy`). |
| D15 | Gateway API keys can only be minted with a SIWE JWT, not with another `csk_` key | A leaked key then can't mint more keys. |
| D16 | `responseHash = keccak256(assistant message content)`, `requestHash = keccak256(canonical JSON of the forwarded body, keys sorted)` | The spec says "full response text". For streams we hash the concatenated deltas, so streaming and non-streaming hash the same way. |
| D17 | Usage rows carry `usageSource` (`upstream` / `estimated`) | If AIPG omits the usage block, tokens are estimated (chars/4) and flagged rather than silently invented. The flag is not part of the leaf. |
| D18 | Dashboard: anvil-only "dev wallets" | Lets the local demo and fallback run without a browser extension. They use only the public anvil keys, only on chain 31337, and are disabled in `testnet:up`. |
| D19 | `local:up` seeds one cancelled subscription | Gives attack #3 a target immediately. |
| D20 | Testnet is Ethereum Sepolia (11155111) instead of Base Sepolia | No Base Sepolia faucet was usable without mainnet ETH. The contracts are chain-agnostic, and Base Sepolia (84532) is still supported (`--chain 84532`). `cost_model.json` still uses the measured Base Sepolia gas price, so the cost analysis applies to Base. |
| D21 | Testnet deploys use `forge script --skip-simulation` | At the time of deployment, Sepolia's fork charged about 5× the cancun price for contract creation (receipts: MockUSDC 6.53M gas, SubscriptionVault 11.65M gas), so Forge's local gas simulation ran out of gas twice. With `--skip-simulation`, Forge takes gas limits from the node's `eth_estimateGas`. Local and anvil gas figures in `results/` are cancun-priced; Base Sepolia and Base mainnet pricing still applies to the cost model. |

## 3. Design decisions

- **Anchored schedule.** `nextChargeAt += period` (not `now + period`). A late keeper does not shift the billing date, and catch-up after an outage settles each missed period exactly once (`keeper_outage.json`).
- **Pull-with-cap rather than allowance-as-limit.** The subscriber may grant 12× price, but the vault has no amount parameter and enforces once per period. A compromised keeper gains nothing. Only the vault holds the allowance.
- **Grace < period.** A subscription that is never paid lapses at the first charge attempt after grace, instead of accumulating debt.
- **Failure is not a revert.** `ChargeFailed` and `SubscriptionLapsed` are state transitions with events, so `chargeBatch` never reverts on one bad subscriber and the keeper earns no fee on failures.
- **Keeper fee on success only, paid from the price.** It is 0.25 % of price, credited to `msg.sender`. Whoever does the work gets paid, with no registration.
- **Pull payments for revenue.** `withdraw` pays only `msg.sender`'s own balance. There is no admin and no payee setter, which gives solvency invariant I3 and attack property 5.
- **Permit in try/catch.** A front-run permit (signature copied from the mempool) doesn't break enrolment, because the allowance is already set.
- **Gateway entitlement cache (15 s)** keeps per-request latency off the RPC. The worst case is 15 s of service after an entitlement ends, which is far below one period.
- **Mock and live share one code path.** The mock returns a synthetic `Response` (JSON or SSE), so tests exercise the exact streaming, metering and hashing code used live.
- **Live-budget counter is persisted in SQLite and reserved before the upstream call**, so restarts and concurrent requests cannot exceed `AIPG_MAX_LIVE_REQUESTS`.

## 4. Threat model

| Actor | Can | Cannot (and the test that shows it) |
|---|---|---|
| Keeper / any EOA | Trigger due charges; earn the 0.25 % fee; delay charges by not acting | Charge early (`test_KeeperCannot_ChargeEarly`, fuzz `testFuzz_ChargeBeforeDueReverts`); charge twice per period (`…ChargeTwiceInPeriod`); charge cancelled/lapsed subs (`…ChargeCancelled`, I2); pull more than price (`…PullMoreThanPrice`, `testFuzz_ChargedAmountEqualsPrice`, I1); take others' funds (`…RedirectPayeeFunds`, I5) |
| Provider | Create plans, close them to new subscribers, withdraw its own revenue | Change price/period/token/payee (`test_NoTermSetters`); stop existing subs by closing (`test_InactivePlanDoesNotAffectExistingSubs`); pull from subscribers directly |
| Subscriber | Cancel any time (keeps access until paid-through), revoke allowance, let it lapse | Be charged by anyone other than the vault; get service past grace without paying (`test_PastDueThenLapse`) |
| Gateway | Gate access to its AIPG key; meter; commit roots | Move funds. It **can** mis-meter or omit rows: roots bind it to what it recorded and don't prove honesty. |
| Front-runner | Submit a subscriber's permit first | Break enrolment (`test_SubscribeWithPermit_FrontRunFallback`) |
| Reentrancy via token hooks | — | `nonReentrant` on all state-changing vault entry points, and state is updated before transfer (CEI) |

## 5. Known limitations (stated honestly)

- **The gateway is a trusted metering party.** A usage root proves inclusion in what the gateway recorded, not that the record is complete or correct.
- **One AIPG API key** is shared behind the gateway. Per-wallet limits are enforced by the gateway, not by AIPG.
- **Worker payouts are not automated** (*stretch*: Merkle-claim splitter from the epoch roots).
- **Mock token**, not real USDC. Fee-on-transfer or rebasing tokens are not supported.
- **No audit.** **Testnet only.**
- `dueSubscriptions` scans subscription ids linearly, including terminal ones. That's fine for a demo, but a production deployment would need an off-chain index or a due-queue.
- `chargeBatch` pre-checks balance and allowance. A token whose `transferFrom` reverts for other reasons (blocklists, pauses) would revert the whole batch.
- The solvency invariant is `balance == Σ claimable` only for tokens arriving through the protocol. Tokens sent directly to the vault are stuck, though this is harmless.
- Entitlement is cached 15 s in the gateway.
- Plan metadata is a free-form string (seeded as a `data:` JSON URI). It is not validated.

## 6. Tool and library versions

| Tool / library | Version |
|---|---|
| Foundry (forge/anvil/cast) | 1.8.5 (Homebrew) |
| Solidity | 0.8.24, optimizer 200 runs, EVM cancun |
| OpenZeppelin Contracts | 5.1.0 (vendored in `contracts/lib`) |
| forge-std | 1.17.0 (vendored) |
| Node.js / pnpm | 22.23.1 / 9.9.0 |
| TypeScript / tsx | 5.6.3 / 4.19.1 |
| viem | 2.21.37 |
| wagmi / RainbowKit / TanStack Query | 2.12.25 / 2.2.0 / 5.59.16 |
| Next.js / React / Tailwind | 14.2.15 / 18.3.1 / 3.4.14 |
| Express / better-sqlite3 / jsonwebtoken | 4.21.1 / 11.5.0 / 9.0.2 |
| @openzeppelin/merkle-tree | 1.0.7 |
| Python / matplotlib | 3.14.4 / 3.10.7 |

## 7. Deployed addresses and verification

Ethereum Sepolia (chainId 11155111), deployed from `0xdb0C7Acf5560eA87eD7D5D7C570dF21092ac62E7` starting at block 11925719. Committer (gateway) `0x6c9e15ce9e9B812d7746DDab4926b2eBFE9fade2`, keeper fee 25 bps. Seeded demo plan #1 (20 mUSDC / 180 s / 60 s) and production-shaped plan #2 (20 mUSDC / 30 d / 3 d). Deployment receipts: `contracts/broadcast/{Deploy,Seed}.s.sol/11155111/run-latest.json`.

| Contract | Address | Etherscan |
|---|---|---|
| MockUSDC | `0x75e8B2f30a7c08cf3967A2745dFAb0CF418Ced96` | [verified](https://sepolia.etherscan.io/address/0x75e8B2f30a7c08cf3967A2745dFAb0CF418Ced96#code) |
| PlanRegistry | `0x9109E3Af83D6499E4d433128B60CDAc5505Cc815` | [verified](https://sepolia.etherscan.io/address/0x9109E3Af83D6499E4d433128B60CDAc5505Cc815#code) |
| SubscriptionVault | `0x9bC880415C54122cB64463888Db6a94Bf285dB8a` | [verified](https://sepolia.etherscan.io/address/0x9bC880415C54122cB64463888Db6a94Bf285dB8a#code) |
| UsageRootRegistry | `0x3fF143e67616114B4F638b332BaF060Cb8e8696C` | [verified](https://sepolia.etherscan.io/address/0x3fF143e67616114B4F638b332BaF060Cb8e8696C#code) |

Local anvil (deterministic, chainId 31337): MockUSDC `0x5FbDB2315678afecb367f032d93F642f64180aa3`, PlanRegistry `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, SubscriptionVault `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`, UsageRootRegistry `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`.
