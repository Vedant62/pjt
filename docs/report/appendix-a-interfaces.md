# Appendix A — Contract Interfaces (as built)

Copied from `docs/REPORT_NOTES.md` §1. Items marked `ADDED` are additive deviations from SPEC.md (Appendix B).

```solidity
// PlanRegistry
function createPlan(address token, uint96 price, uint32 period, uint32 gracePeriod, address payee, string metadataURI) returns (uint256 planId);
function setPlanActive(uint256 planId, bool active);                 // provider only
function getPlan(uint256 planId) view returns (Plan memory);
function getPlanTerms(uint256 planId) view returns (address payee, address token, uint96 price, uint32 period, uint32 gracePeriod, bool active); // ADDED
function planCount() view returns (uint256);
events: PlanCreated(planId, provider, payee, token, price, period, gracePeriod, metadataURI), PlanActiveSet(planId, active)
errors: ZeroAddress, ZeroPrice, ZeroPeriod, GraceNotLessThanPeriod(grace, period), UnknownPlan(id), NotProvider

// SubscriptionVault (keeperFeeBps immutable, = 25 in Deploy.s.sol; max 1,000)
enum Status { None, Active, PastDue, Lapsed, Cancelled }
struct Subscription { address subscriber; uint64 planId; uint64 startedAt; uint64 nextChargeAt;
                      uint64 pastDueSince; uint32 chargeCount; Status status; }
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
events: CommitterSet(committer, allowed), RootCommitted(planId, epoch, root, rowCount, totalTokens, uri)
errors: NotCommitter, ZeroRoot, RootAlreadyCommitted(planId, epoch)

// MockUSDC: ERC20("Mock USD Coin","mUSDC") + ERC20Permit, decimals 6
function mint(address to, uint256 amount);   // anyone; ≤ 1,000 mUSDC per call; error MintCapExceeded(requested, cap)
```

## Gateway HTTP API

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /auth/nonce` | — | SIWE nonce |
| `POST /auth/verify` | — | Verify SIWE message → JWT (1 h) |
| `POST /keys` | JWT only | Issue a `csk_…` API key |
| `POST /v1/chat/completions` | JWT or `csk_` | OpenAI-compatible chat (stream or not); 402 if not entitled |
| `GET /v1/models` | — | Allowlisted models |
| `GET /usage/me` | JWT or `csk_` | The caller's own usage rows |
| `GET /epochs` | — | Committed epochs with tx hashes |
| `GET /epochs/:epoch/rows` | — | An epoch's usage rows |
| `GET /epochs/:epoch/tree` | — | An epoch's dumped Merkle tree |
| `GET /epochs/:epoch/proof/:rowId` | — | Leaf values + Merkle proof |
| `GET /health` | — | Mode, live budget, last epoch, cache size |

Error responses from `/v1/chat/completions`: `402 payment_required`, `400 model_not_allowed` / `invalid_request`, `429 rate_limited` (live), `503 live_budget_exhausted` (live), `502 chain_unavailable`.

*Routes and auth middleware from `gateway/src/app.ts` (`requireJwt` on `/keys`; `requireWallet`, which accepts a JWT or `csk_` key, on `/v1/chat/completions` and `/usage/me`).*

Note that `/epochs/:epoch/rows` needs no authentication. **[STUDENT: check what fields it returns. If it exposes wallets and token counts, say so as a privacy trade-off of public verifiability.]**
