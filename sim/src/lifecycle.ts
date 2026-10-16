/**
 * results/lifecycle_testnet.json — scripted lifecycle on Base Sepolia (the deployed demo plan, 180 s period / 60 s grace):
 * subscribe (permit) → 3 keeper charges → drain balance → ChargeFailed → PastDue → top up → recovered → cancel →
 * entitled until paid-through → not entitled. Each step records tx hash, block timestamp, gas and on-chain status.
 * Needs LIFECYCLE_SUBSCRIBER_KEY and LIFECYCLE_KEEPER_KEY (both with a little Base Sepolia ETH). Takes ~15 minutes.
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseEventLogs, parseSignature, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor, getDeployment, mockUSDCAbi, subscriptionVaultAbi, SubStatus } from "@cashew/shared";
import { meta, writeResult } from "./lib/common";

const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const chain = chainFor(84532, RPC);
const dep = getDeployment(84532);
const planId = BigInt(dep.demoPlanId ?? 1);
const sub = privateKeyToAccount(process.env.LIFECYCLE_SUBSCRIBER_KEY as Hex);
const keeper = privateKeyToAccount(process.env.LIFECYCLE_KEEPER_KEY as Hex);
const pub = createPublicClient({ chain, transport: http(RPC) });
const ws = createWalletClient({ chain, account: sub, transport: http(RPC) });
const wk = createWalletClient({ chain, account: keeper, transport: http(RPC) });
const vault = { address: dep.SubscriptionVault, abi: subscriptionVaultAbi } as const;
const token = { address: dep.MockUSDC, abi: mockUSDCAbi } as const;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const steps: any[] = [];
let subId = 0n;

async function state() {
  const [s, entitled, bal, block] = await Promise.all([
    subId ? pub.readContract({ ...vault, functionName: "getSubscription", args: [subId] }) : null,
    subId ? pub.readContract({ ...vault, functionName: "isEntitled", args: [subId] }) : false,
    pub.readContract({ ...token, functionName: "balanceOf", args: [sub.address] }),
    pub.getBlock(),
  ]);
  return { chainTime: Number(block.timestamp), status: s ? SubStatus[s.status] : "None", entitled, chargeCount: s ? s.chargeCount : 0, nextChargeAt: s ? Number(s.nextChargeAt) : null, pastDueSince: s ? Number(s.pastDueSince) : null, balance: bal.toString() };
}

async function tx(step: string, w: typeof ws, req: any) {
  const { request } = await pub.simulateContract({ ...req, account: w.account });
  const hash = await w.writeContract(request as any);
  const rc = await pub.waitForTransactionReceipt({ hash });
  const block = await pub.getBlock({ blockNumber: rc.blockNumber });
  const after = await state();
  const events = parseEventLogs({ abi: subscriptionVaultAbi, logs: rc.logs }).map((e) => e.eventName);
  const row = { step, txHash: hash, events, blockNumber: Number(rc.blockNumber), blockTimestamp: Number(block.timestamp), gasUsed: Number(rc.gasUsed), txStatus: rc.status, ...after };
  steps.push(row);
  console.log(`${step}: ${after.status} entitled=${after.entitled} charges=${after.chargeCount} gas=${rc.gasUsed} ${hash}`);
  return row;
}

async function observe(step: string) {
  const s = await state();
  steps.push({ step, txHash: null, ...s });
  console.log(`${step}: ${s.status} entitled=${s.entitled}`);
  return s;
}

async function waitChain(until: number) {
  for (;;) {
    const now = Number((await pub.getBlock()).timestamp);
    if (now >= until) return;
    await sleep(Math.min(10_000, (until - now) * 1000 + 1000));
  }
}

const charge = () => tx("keeper charge", wk, { ...vault, functionName: "charge", args: [subId] });

// 0. funds
const bal = await pub.readContract({ ...token, functionName: "balanceOf", args: [sub.address] });
if (bal < 100_000_000n) await tx("mint 100 mUSDC", ws, { ...token, functionName: "mint", args: [sub.address, 100_000_000n] });

// 1. subscribe with permit (12 cycles)
const price = 20_000_000n;
const value = price * 12n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const nonce = await pub.readContract({ ...token, functionName: "nonces", args: [sub.address] });
const sig = await ws.signTypedData({
  domain: { name: "Mock USD Coin", version: "1", chainId: 84532, verifyingContract: dep.MockUSDC },
  types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
  primaryType: "Permit",
  message: { owner: sub.address, spender: dep.SubscriptionVault, value, nonce, deadline },
});
const { v, r, s } = parseSignature(sig);
const latest = await pub.readContract({ ...vault, functionName: "latestSubOf", args: [sub.address, planId] });
if (latest !== 0n) {
  const ls = await pub.readContract({ ...vault, functionName: "getSubscription", args: [latest] });
  if (ls.status === 1 || ls.status === 2) {
    subId = latest;
    await tx("cancel leftover subscription", ws, { ...vault, functionName: "cancel", args: [latest] });
  }
}
await tx("subscribeWithPermit", ws, { ...vault, functionName: "subscribeWithPermit", args: [planId, value, deadline, Number(v), r, s] });
subId = await pub.readContract({ ...vault, functionName: "latestSubOf", args: [sub.address, planId] });

// 2. three keeper charges
for (let i = 0; i < 3; i++) {
  const st = await state();
  await waitChain(st.nextChargeAt!);
  await charge();
}

// 3. drain → ChargeFailed → PastDue (still entitled during grace)
const b = await pub.readContract({ ...token, functionName: "balanceOf", args: [sub.address] });
await tx("drain balance", ws, { ...token, functionName: "transfer", args: [DEAD, b] });
await waitChain((await state()).nextChargeAt!);
await charge(); // expect ChargeFailed(reason 1) → PastDue, still entitled during grace

// 4. top up within grace → keeper recovers
await tx("top up (mint 100)", ws, { ...token, functionName: "mint", args: [sub.address, 100_000_000n] });
await charge();

// 5. cancel → entitled until paid-through → not entitled
await tx("cancel", ws, { ...vault, functionName: "cancel", args: [subId] });
const paidThrough = (await state()).nextChargeAt!;
await observe("after cancel (before paid-through)");
await waitChain(paidThrough + 1);
await observe("after paid-through");

writeResult("lifecycle_testnet.json", {
  ...meta("sim/src/lifecycle.ts", { chainId: 84532, rpc: RPC, explorer: "https://sepolia.basescan.org", subscriber: sub.address, keeper: keeper.address, planId: planId.toString(), subId: subId.toString(), contracts: dep }),
  steps,
});
