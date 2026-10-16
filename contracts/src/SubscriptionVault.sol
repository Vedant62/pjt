// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PlanRegistry} from "./PlanRegistry.sol";

/// @title SubscriptionVault
/// @notice Pull-based recurring payments. A subscriber enrols once (optionally with an
///         EIP-2612 permit). Afterwards ANY account (a "keeper") may trigger a charge once
///         it is due. The contract, not the allowance, enforces the limit: at most
///         `plan.price`, at most once per elapsed period, on an anchored schedule.
contract SubscriptionVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Active,
        PastDue,
        Lapsed,
        Cancelled
    }

    struct Subscription {
        address subscriber;
        uint64 planId;
        uint64 startedAt;
        uint64 nextChargeAt; // anchored schedule: advances by exactly `period` per successful charge
        uint64 pastDueSince; // 0 unless PastDue
        uint32 chargeCount; // includes the initial payment taken at subscribe time
        Status status;
    }

    /// @dev Immutable plan terms cached on first use (they can never change in the registry).
    struct Terms {
        address payee;
        uint96 price;
        address token;
        uint32 period;
        uint32 gracePeriod;
    }

    enum Outcome {
        Charged,
        Failed,
        Lapsed
    }

    uint256 public constant MAX_BATCH = 200;
    uint16 public constant MAX_KEEPER_FEE_BPS = 1_000; // 10%

    PlanRegistry public immutable registry;
    /// @notice Keeper reward in basis points of `price`, paid to the caller of a successful charge.
    uint16 public immutable keeperFeeBps;

    uint256 private _subCount;
    mapping(uint256 subId => Subscription) private _subs;
    mapping(address subscriber => mapping(uint256 planId => uint256 subId)) private _latestSub;
    mapping(address account => mapping(address token => uint256)) private _claimable;
    mapping(uint256 planId => Terms) private _terms;

    event Subscribed(
        uint256 indexed subId, uint256 indexed planId, address indexed subscriber, uint256 amount, uint64 nextChargeAt
    );
    event Charged(
        uint256 indexed subId,
        uint256 indexed planId,
        uint256 amount,
        uint256 fee,
        address indexed keeper,
        uint64 newNextChargeAt
    );
    event ChargeFailed(uint256 indexed subId, uint8 reason); // 1 = balance, 2 = allowance
    event SubscriptionLapsed(uint256 indexed subId);
    event Cancelled(uint256 indexed subId, uint64 paidThrough);
    event Withdrawn(address indexed account, address indexed token, uint256 amount);

    error NotDue();
    error NotChargeable(Status status);
    error NotSubscriber();
    error NothingToWithdraw();
    error PlanInactive(uint256 planId);
    error AlreadySubscribed(uint256 subId);
    error BatchTooLarge(uint256 size);
    error FeeTooHigh();

    uint8 internal constant REASON_BALANCE = 1;
    uint8 internal constant REASON_ALLOWANCE = 2;

    constructor(PlanRegistry registry_, uint16 keeperFeeBps_) {
        if (keeperFeeBps_ > MAX_KEEPER_FEE_BPS) revert FeeTooHigh();
        registry = registry_;
        keeperFeeBps = keeperFeeBps_;
    }

    // ---------------------------------------------------------------------
    // Subscribe
    // ---------------------------------------------------------------------

    /// @notice Enrol with one EIP-2612 signature. If the permit was front-run (already used),
    ///         enrolment still succeeds as long as the resulting allowance is sufficient.
    function subscribeWithPermit(uint256 planId, uint256 permitValue, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 subId)
    {
        Terms memory t = _loadTerms(planId);
        try IERC20Permit(t.token).permit(msg.sender, address(this), permitValue, deadline, v, r, s) {} catch {}
        return _subscribe(planId, t);
    }

    /// @notice Enrol using an allowance the subscriber already granted.
    function subscribe(uint256 planId) external nonReentrant returns (uint256 subId) {
        return _subscribe(planId, _loadTerms(planId));
    }

    function _subscribe(uint256 planId, Terms memory t) private returns (uint256 subId) {
        (,,,,, bool active) = registry.getPlanTerms(planId);
        if (!active) revert PlanInactive(planId);

        uint256 existing = _latestSub[msg.sender][planId];
        if (existing != 0) {
            Status st = _subs[existing].status;
            if (st == Status.Active || st == Status.PastDue) revert AlreadySubscribed(existing);
        }

        subId = ++_subCount;
        uint64 nowTs = uint64(block.timestamp);
        uint64 next = nowTs + t.period;
        _subs[subId] = Subscription({
            subscriber: msg.sender,
            planId: uint64(planId),
            startedAt: nowTs,
            nextChargeAt: next,
            pastDueSince: 0,
            chargeCount: 1,
            status: Status.Active
        });
        _latestSub[msg.sender][planId] = subId;

        // First period is paid immediately by the subscriber; no keeper fee.
        IERC20(t.token).safeTransferFrom(msg.sender, address(this), t.price);
        _claimable[t.payee][t.token] += t.price;

        emit Subscribed(subId, planId, msg.sender, t.price, next);
    }

    // ---------------------------------------------------------------------
    // Charge
    // ---------------------------------------------------------------------

    /// @notice Collect one period from `subId`. Callable by anyone once due.
    function charge(uint256 subId) external nonReentrant {
        Subscription storage s = _subs[subId];
        Status st = s.status;
        if (st != Status.Active && st != Status.PastDue) revert NotChargeable(st);
        if (block.timestamp < s.nextChargeAt) revert NotDue();
        _charge(subId, s);
    }

    /// @notice Charge many subscriptions. Never reverts on a single bad id.
    /// @return ok successful charges
    /// @return failed transitions to PastDue or Lapsed
    /// @return skipped ids that were not due or not chargeable
    function chargeBatch(uint256[] calldata subIds)
        external
        nonReentrant
        returns (uint256 ok, uint256 failed, uint256 skipped)
    {
        uint256 n = subIds.length;
        if (n > MAX_BATCH) revert BatchTooLarge(n);
        for (uint256 i; i < n; ++i) {
            Subscription storage s = _subs[subIds[i]];
            Status st = s.status;
            if ((st != Status.Active && st != Status.PastDue) || block.timestamp < s.nextChargeAt) {
                ++skipped;
                continue;
            }
            if (_charge(subIds[i], s) == Outcome.Charged) ++ok;
            else ++failed;
        }
    }

    /// @dev Caller has verified the subscription is chargeable and due.
    function _charge(uint256 subId, Subscription storage s) private returns (Outcome) {
        Terms memory t = _terms[s.planId];
        address subscriber = s.subscriber;
        IERC20 token = IERC20(t.token);

        uint8 reason;
        if (token.balanceOf(subscriber) < t.price) reason = REASON_BALANCE;
        else if (token.allowance(subscriber, address(this)) < t.price) reason = REASON_ALLOWANCE;

        if (reason != 0) {
            if (block.timestamp >= uint256(s.nextChargeAt) + t.gracePeriod) {
                s.status = Status.Lapsed;
                s.pastDueSince = 0;
                emit SubscriptionLapsed(subId);
                return Outcome.Lapsed;
            }
            if (s.status != Status.PastDue) {
                s.status = Status.PastDue;
                s.pastDueSince = s.nextChargeAt;
            }
            emit ChargeFailed(subId, reason);
            return Outcome.Failed;
        }

        uint64 next = s.nextChargeAt + t.period;
        s.nextChargeAt = next;
        s.chargeCount += 1;
        s.status = Status.Active;
        s.pastDueSince = 0;

        uint256 fee = (uint256(t.price) * keeperFeeBps) / 10_000;
        token.safeTransferFrom(subscriber, address(this), t.price);
        _claimable[t.payee][t.token] += t.price - fee;
        if (fee != 0) _claimable[msg.sender][t.token] += fee;

        emit Charged(subId, s.planId, t.price, fee, msg.sender, next);
        return Outcome.Charged;
    }

    // ---------------------------------------------------------------------
    // Cancel / withdraw
    // ---------------------------------------------------------------------

    /// @notice Stop future charges. Access continues until the paid-through time (`nextChargeAt`).
    function cancel(uint256 subId) external {
        Subscription storage s = _subs[subId];
        if (msg.sender != s.subscriber) revert NotSubscriber();
        Status st = s.status;
        if (st != Status.Active && st != Status.PastDue) revert NotChargeable(st);
        s.status = Status.Cancelled;
        s.pastDueSince = 0;
        emit Cancelled(subId, s.nextChargeAt);
    }

    /// @notice Pay out msg.sender's own claimable balance of `token`.
    function withdraw(address token) external nonReentrant {
        uint256 amount = _claimable[msg.sender][token];
        if (amount == 0) revert NothingToWithdraw();
        _claimable[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function isEntitled(uint256 subId) public view returns (bool) {
        Subscription storage s = _subs[subId];
        Status st = s.status;
        if (st == Status.Active || st == Status.PastDue) {
            return block.timestamp < uint256(s.nextChargeAt) + _terms[s.planId].gracePeriod;
        }
        if (st == Status.Cancelled) return block.timestamp < s.nextChargeAt;
        return false;
    }

    /// @notice The subscriber's entitled subscription to `planId`, or 0 if none.
    function entitledSubOf(address subscriber, uint256 planId) external view returns (uint256 subId) {
        subId = _latestSub[subscriber][planId];
        if (subId != 0 && !isEntitled(subId)) subId = 0;
    }

    /// @notice The subscriber's most recent subscription to `planId` (any status), or 0.
    function latestSubOf(address subscriber, uint256 planId) external view returns (uint256) {
        return _latestSub[subscriber][planId];
    }

    function getSubscription(uint256 subId) external view returns (Subscription memory) {
        return _subs[subId];
    }

    function claimable(address account, address token) external view returns (uint256) {
        return _claimable[account][token];
    }

    /// @notice Scan up to `limit` subscription ids starting at `cursor` and return those that are
    ///         chargeable and due. `nextCursor` is 0 once the scan reached the end.
    function dueSubscriptions(uint256 cursor, uint256 limit)
        external
        view
        returns (uint256[] memory ids, uint256 nextCursor)
    {
        uint256 total = _subCount;
        uint256 start = cursor == 0 ? 1 : cursor;
        if (start > total || limit == 0) return (new uint256[](0), 0);
        uint256 end = start + limit - 1;
        if (end > total) end = total;

        uint256[] memory buf = new uint256[](end - start + 1);
        uint256 count;
        for (uint256 id = start; id <= end; ++id) {
            Subscription storage s = _subs[id];
            Status st = s.status;
            if ((st == Status.Active || st == Status.PastDue) && block.timestamp >= s.nextChargeAt) {
                buf[count++] = id;
            }
        }
        assembly {
            mstore(buf, count)
        }
        return (buf, end < total ? end + 1 : 0);
    }

    function subscriptionCount() external view returns (uint256) {
        return _subCount;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _loadTerms(uint256 planId) private returns (Terms memory t) {
        t = _terms[planId];
        if (t.token == address(0)) {
            (address payee, address token, uint96 price, uint32 period, uint32 grace,) = registry.getPlanTerms(planId);
            t = Terms({payee: payee, price: price, token: token, period: period, gracePeriod: grace});
            _terms[planId] = t;
        }
    }
}
