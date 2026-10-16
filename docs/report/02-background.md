# Chapter 2 — Background and Related Work

> Every external reference below is marked **[VERIFY]**. The descriptions are the author's understanding and must be checked against the primary source (EIP page, paper or official documentation) before submission. Add full bibliographic details in [references.md](references.md).

## 2.1 ERC-20 allowances

ERC-20 [R1] is the standard fungible-token interface on Ethereum. Besides `transfer`, it defines a two-step delegated transfer: the owner calls `approve(spender, value)` and the spender later calls `transferFrom(owner, to, amount)` for any `amount ≤ allowance`. The allowance limits the *total* that may be moved. It says nothing about *when*, *how often* or *to whom* (the `to` argument is chosen by the spender).

Two well-known problems follow:

- **Over-broad approvals.** Applications often ask for an "infinite" approval (`type(uint256).max`) so the user does not have to approve again. Any bug or key compromise in the spender then exposes the user's entire balance of that token. **[VERIFY: cite a survey or incident report on approval-based losses.]**
- **The approve/transferFrom race.** Changing a non-zero allowance to another non-zero value lets a spender front-run the change and spend both. This was documented early in ERC-20's life **[VERIFY: Vladimirov & Khovratovich, "ERC20 API: An Attack Vector on Approve/TransferFrom Methods", 2016]**.

Cashew does not change ERC-20. It accepts that the subscriber grants an allowance to one contract, the vault, and makes that contract the place where the limit is enforced (§5).

## 2.2 EIP-712 and EIP-2612 `permit`

**EIP-712** [R2] defines how to hash and sign *typed structured data*, so a wallet can show the user what they are signing and the signature is bound to a domain (contract name, version, chain id, verifying contract). **EIP-2612** [R3] uses EIP-712 to add `permit(owner, spender, value, deadline, v, r, s)` to ERC-20 tokens. A signed message sets the allowance, so the user does not need a separate `approve` transaction. Anyone can submit the permit, which is why it can be front-run (submitted first by someone who saw it in the mempool). A front-run permit is harmless to the owner but makes the original transaction revert unless the caller tolerates it. Cashew wraps `permit` in `try/catch` and proceeds if the allowance is already sufficient (§5.2; test `test_SubscribeWithPermit_FrontRunFallback`).

OpenZeppelin Contracts v5 provides `ERC20Permit` [R4], which `MockUSDC` uses. **[VERIFY: OpenZeppelin documentation, ERC20Permit and SafeERC20, v5.1.]**

A related later design is Uniswap's **Permit2** **[VERIFY]**, which adds signature-based transfers with expiring allowances for tokens without native `permit`. Cashew does not use it; it is noted as future work for tokens without EIP-2612 support (Chapter 10).

## 2.3 Subscription proposals: ERC-948 and ERC-1337

Recurring payments on Ethereum were discussed as standards around 2018.

- **ERC-948** **[VERIFY: GitHub issue "Recurring Billing / Subscription standard", ethereum/EIPs #948, 2018]** proposed a standard interface for recurring subscriptions and collected the main design questions: who triggers the payment, how the limit is expressed, and how the user cancels.
- **ERC-1337** **[VERIFY: "Subscriptions on the blockchain", ethereum/EIPs #1337, 2018, associated with Gitcoin]** proposed meta-transaction-based subscriptions. The subscriber signs a subscription message once, and a relayer submits periodic executions, paid by a "gas price" field taken from the subscriber.

These proposals established the pattern Cashew follows: one signature from the subscriber and periodic execution by someone else. To the author's knowledge neither was finalised as a standard **[VERIFY status on eips.ethereum.org]**. Cashew differs in three ways: (i) the price and period are fixed on-chain in an immutable plan rather than carried in each signed message; (ii) the schedule is anchored, so late execution never shifts or doubles charges; and (iii) failure and lapse are explicit states that drive an entitlement rule used by an off-chain service.

## 2.4 Streaming payments

**Superfluid** **[VERIFY: Superfluid protocol documentation / whitepaper]** implements continuous "money streams": a sender opens a flow at a rate per second, balances update in real time, and the flow is closed when the sender's deposit runs out. It requires "Super Tokens" (wrapped ERC-20s). **Sablier** and **EIP-1620 "Money Streaming"** **[VERIFY: EIP-1620, Paul Razvan Berg, 2018]** stream a pre-deposited amount linearly over time.

Streaming is a good fit for pay-as-you-go access, but it is a different model from a priced plan. The user locks or wraps funds up front, and "price per month" becomes "rate per second". Cashew keeps the familiar subscription model (fixed price, fixed period, cancel any time, access until paid-through) and does not require deposits or wrapped tokens. The subscriber's funds stay in their own wallet until each charge.

## 2.5 Keeper and automation networks

Smart contracts cannot run on a timer. Some external account must send a transaction. *Keeper* or *automation* networks provide this as a service:

- **Chainlink Automation** (formerly Chainlink Keepers) **[VERIFY: Chainlink documentation]**: a contract implements `checkUpkeep` (a view that returns whether work is needed) and `performUpkeep` (the action). A decentralized set of nodes calls `performUpkeep` when `checkUpkeep` returns true, and is paid from a pre-funded balance.
- **Gelato** **[VERIFY: Gelato Network documentation]**: a similar task-execution network with its own payment model.

Cashew's keeper is deliberately simpler. `charge` and `chargeBatch` are open to *anyone*, and the reward (0.25 % of the price) is paid by the protocol to `msg.sender` on success. Any EOA, a script, or an automation network can therefore be the keeper, and several can run at once. Correctness never depends on the keeper, only liveness does (§7). A `checkUpkeep`/`performUpkeep` wrapper for Chainlink Automation is listed as a stretch goal (Chapter 10).

## 2.6 Merkle trees and commitments

A Merkle tree [R5] hashes data blocks pairwise up to a single root. A short *inclusion proof* (the sibling hashes on the path) lets anyone check that a given leaf is part of the tree with that root. Publishing the root on-chain is a cheap, binding commitment to a whole dataset.

Cashew uses OpenZeppelin's `StandardMerkleTree` (JavaScript library `@openzeppelin/merkle-tree`) **[VERIFY: library README]**. Leaves are ABI-encoded and **double-hashed** (`keccak256(bytes.concat(keccak256(abi.encode(...))))`), which prevents second-preimage confusion between leaves and internal nodes. On-chain verification uses OpenZeppelin's `MerkleProof` library. `UsageRootRegistry.hashRow` recomputes the leaf in Solidity, and a test checks that it equals the JavaScript leaf (§8).

A commitment proves that a row was *included*. It does not prove that the data are *true* or *complete*. This distinction drives the main limitation in Chapter 10.

## 2.7 Sign-In With Ethereum (EIP-4361) and HTTP 402

**EIP-4361 (SIWE)** **[VERIFY]** standardises a human-readable message that a wallet signs to prove control of an address to an off-chain service. It includes a domain, nonce, issued-at time and chain id to prevent replay. Cashew's gateway uses viem's implementation of EIP-4361 (deviation D9) and issues a short-lived JWT after verification.

**HTTP 402 "Payment Required"** is a status code reserved in the HTTP specification **[VERIFY: RFC 9110 §15.5.3]** with no standard semantics. Cashew uses it to tell an API client that the wallet is authenticated but its subscription is not entitled, and includes the on-chain status in the JSON body (§6.2).

## 2.8 AI Power Grid

**AI Power Grid (AIPG)** **[VERIFY: project website / documentation for an accurate description and citation]** is a decentralized network in which independent GPU *workers* serve generative-AI models (text, image, video, audio) and clients submit jobs through a central API. It exposes an OpenAI-compatible endpoint (`/v1/chat/completions`) plus `/v1/workers` and `/v1/status/models` (as used by `sim/src/grid-snapshot.ts`). At the time of the project's snapshot, 8 workers were online, serving text, image, video and audio models (`results/grid_snapshot.json`, §9.8).

Cashew does not modify AIPG. It sits in front of the API as a paying customer that resells access, gated by on-chain entitlement.

## 2.9 Positioning

| Approach | Who triggers | Limit enforced by | Funds location | Late trigger | Off-chain gating |
|---|---|---|---|---|---|
| Manual payment | Subscriber | Subscriber | Subscriber wallet | Service gap | Ad hoc |
| Allowance pull by merchant | Merchant | Allowance only | Subscriber wallet | Merchant-defined | Ad hoc |
| ERC-1337-style signed subscription | Relayer | Signed message terms | Subscriber wallet | Depends on implementation | Not specified |
| Streaming (Superfluid / Sablier) | Continuous | Flow rate / deposit | Deposit or wrapped token | N/A | Possible |
| **Cashew** | **Anyone (keeper)** | **Vault logic: `price`, once per period, anchored** | **Subscriber wallet** | **Late, not lost; never doubled** | **Entitlement rule → HTTP 402** |

The columns for the external approaches are qualitative summaries **[VERIFY each against its source]**.
