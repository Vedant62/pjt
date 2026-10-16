// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PlanRegistry
/// @notice Providers publish subscription plans. Economic terms (token, price, period,
///         grace, payee) are immutable once created; there is deliberately no setter.
contract PlanRegistry {
    struct Plan {
        address provider; // msg.sender at creation
        address payee; // receives revenue; immutable
        address token; // ERC-20 settlement token; immutable
        uint96 price; // per-period price in token units; immutable
        uint32 period; // seconds; immutable; > 0
        uint32 gracePeriod; // seconds; immutable; MUST be < period
        bool active; // provider can close to NEW subscriptions only
        string metadataURI; // name/description/features (JSON or ipfs://)
    }

    /// @dev Plan ids start at 1 so that 0 can mean "no plan".
    Plan[] private _plans;

    event PlanCreated(
        uint256 indexed planId,
        address indexed provider,
        address indexed payee,
        address token,
        uint96 price,
        uint32 period,
        uint32 gracePeriod,
        string metadataURI
    );
    event PlanActiveSet(uint256 indexed planId, bool active);

    error ZeroAddress();
    error ZeroPrice();
    error ZeroPeriod();
    error GraceNotLessThanPeriod(uint32 gracePeriod, uint32 period);
    error UnknownPlan(uint256 planId);
    error NotProvider();

    function createPlan(
        address token,
        uint96 price,
        uint32 period,
        uint32 gracePeriod,
        address payee,
        string calldata metadataURI
    ) external returns (uint256 planId) {
        if (token == address(0) || payee == address(0)) revert ZeroAddress();
        if (price == 0) revert ZeroPrice();
        if (period == 0) revert ZeroPeriod();
        if (gracePeriod >= period) revert GraceNotLessThanPeriod(gracePeriod, period);

        _plans.push(
            Plan({
                provider: msg.sender,
                payee: payee,
                token: token,
                price: price,
                period: period,
                gracePeriod: gracePeriod,
                active: true,
                metadataURI: metadataURI
            })
        );
        planId = _plans.length;
        emit PlanCreated(planId, msg.sender, payee, token, price, period, gracePeriod, metadataURI);
    }

    /// @notice Open or close a plan to NEW subscriptions. Existing subscriptions are unaffected.
    function setPlanActive(uint256 planId, bool active) external {
        Plan storage p = _plan(planId);
        if (msg.sender != p.provider) revert NotProvider();
        p.active = active;
        emit PlanActiveSet(planId, active);
    }

    function getPlan(uint256 planId) external view returns (Plan memory) {
        return _plan(planId);
    }

    /// @notice Economic terms without the metadata string (cheaper for on-chain callers).
    function getPlanTerms(uint256 planId)
        external
        view
        returns (address payee, address token, uint96 price, uint32 period, uint32 gracePeriod, bool active)
    {
        Plan storage p = _plan(planId);
        return (p.payee, p.token, p.price, p.period, p.gracePeriod, p.active);
    }

    function planCount() external view returns (uint256) {
        return _plans.length;
    }

    function _plan(uint256 planId) private view returns (Plan storage) {
        if (planId == 0 || planId > _plans.length) revert UnknownPlan(planId);
        return _plans[planId - 1];
    }
}
