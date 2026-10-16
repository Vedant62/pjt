/**
 * End-to-end gateway test against a local anvil with Cashew deployed + seeded (`pnpm local:chain`).
 * Uses a fresh random wallet each run, mock AIPG mode, and 1-second epochs (so it never collides
 * with the 300-second epochs a running dev gateway commits).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  createTestClient,
  createWalletClient,
  http,
  parseEther,
  parseSignature,
  publicActions,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { foundry } from "viem/chains";
import { getDeployment, mockUSDCAbi, subscriptionVaultAbi, usageRootRegistryAbi } from "@cashew/shared";
import { loadConfig } from "../src/config";
import { createGateway } from "../src/app";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const dep = getDeployment(31337);
const planId = BigInt(dep.demoPlanId ?? 1);
const dataDir = mkdtempSync(join(tmpdir(), "cashew-gw-"));

const cfg = loadConfig(
  {},
  {
    rpcUrl: RPC,
    chainId: 31337,
    planId,
    dataDir,
    epochDir: join(dataDir, "epochs"),
    epochSeconds: 1,
    mockTtftMs: 5,
    mockTokenMs: 0,
    entitlementCacheMs: 15_000,
  },
);
const gw = createGateway(cfg, { log: () => {} });
const server = gw.app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  server.close();
  gw.close();
});

const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) }).extend(publicActions);
const account = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ chain: foundry, account, transport: http(RPC) });

const chat = (token: string, body: object) =>
  fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: "qwen3:8b", messages: [{ role: "user", content: "hello grid" }], ...body }),
  });

let jwt = "";
let subId = 0n;
let rowId = 0;

test("SIWE sign-in issues a JWT", async () => {
  await testClient.setBalance({ address: account.address, value: parseEther("10") });
  const { nonce } = (await (await fetch(`${base}/auth/nonce`)).json()) as { nonce: string };
  const message = createSiweMessage({
    address: account.address,
    chainId: 31337,
    domain: cfg.siweDomain,
    nonce,
    uri: `http://${cfg.siweDomain}`,
    version: "1",
    statement: "Sign in to the Cashew Gateway",
  });
  const signature = await wallet.signMessage({ message });
  const r = await fetch(`${base}/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  assert.equal(r.status, 200);
  jwt = ((await r.json()) as { token: string }).token;
  assert.ok(jwt);

  // Nonce is single-use.
  const replay = await fetch(`${base}/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  assert.equal(replay.status, 401);
});

test("unauthenticated and unsubscribed requests are refused", async () => {
  assert.equal((await chat("garbage", {})).status, 401);
  const r = await chat(jwt, {});
  assert.equal(r.status, 402);
  const j = (await r.json()) as { error: { type: string; status: string; subId: string } };
  assert.equal(j.error.type, "payment_required");
  assert.equal(j.error.status, "None");
  assert.equal(j.error.subId, "0");
});

test("subscribe with one EIP-2612 permit", async () => {
  await wallet.writeContract({ address: dep.MockUSDC, abi: mockUSDCAbi, functionName: "mint", args: [account.address, 100_000_000n] });
  const price = 20_000_000n;
  const value = price * 12n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = await testClient.readContract({ address: dep.MockUSDC, abi: mockUSDCAbi, functionName: "nonces", args: [account.address] });
  const sig = await wallet.signTypedData({
    domain: { name: "Mock USD Coin", version: "1", chainId: 31337, verifyingContract: dep.MockUSDC },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: account.address, spender: dep.SubscriptionVault, value, nonce, deadline },
  });
  const { v, r, s } = parseSignature(sig);
  const hash = await wallet.writeContract({
    address: dep.SubscriptionVault,
    abi: subscriptionVaultAbi,
    functionName: "subscribeWithPermit",
    args: [planId, value, deadline, Number(v), r, s],
  });
  await testClient.waitForTransactionReceipt({ hash });
  subId = await testClient.readContract({
    address: dep.SubscriptionVault,
    abi: subscriptionVaultAbi,
    functionName: "entitledSubOf",
    args: [account.address, planId],
  });
  assert.ok(subId > 0n);
});

test("entitled wallet gets a completion (non-stream) and a usage row", async () => {
  // The 402 above is cached for 15 s; a fresh check is needed after subscribing.
  gw.entitlements.invalidate(account.address);
  const r = await chat(jwt, { max_tokens: 9999 });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-cashew-entitlement-cache"), "miss");
  assert.equal(r.headers.get("x-cashew-sub-id"), subId.toString());
  assert.ok(r.headers.get("x-grid-job-id"));
  rowId = Number(r.headers.get("x-cashew-row-id"));
  const j = (await r.json()) as { usage: { completion_tokens: number }; choices: { message: { content: string } }[] };
  assert.ok(j.choices[0].message.content.length > 0);
  assert.ok(j.usage.completion_tokens <= cfg.maxTokensCap, "max_tokens is capped");
  const row = gw.db.usageById(rowId)!;
  assert.equal(row.wallet, account.address.toLowerCase());
  assert.equal(row.subId, subId.toString());
  assert.equal(row.usageSource, "upstream");
});

test("streaming completion passes SSE through and records usage", async () => {
  const r = await chat(jwt, { stream: true, max_tokens: 16 });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-cashew-entitlement-cache"), "hit");
  const text = await r.text();
  assert.match(text, /data: \[DONE\]/);
  assert.match(text, /"usage":\{"prompt_tokens"/);
  const rows = gw.db.usageByWallet(account.address.toLowerCase());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].completionTokens, 16);
  assert.equal(rows[0].stream, 1);
});

test("policy: model allowlist", async () => {
  const r = await chat(jwt, { model: "gpt-4o" });
  assert.equal(r.status, 400);
});

test("csk_ API keys work on /v1 but cannot mint more keys", async () => {
  const r = await fetch(`${base}/keys`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } });
  assert.equal(r.status, 201);
  const { key } = (await r.json()) as { key: string };
  assert.match(key, /^csk_[0-9a-f]{48}$/);
  assert.equal((await chat(key, {})).status, 200);
  const again = await fetch(`${base}/keys`, { method: "POST", headers: { authorization: `Bearer ${key}` } });
  assert.equal(again.status, 401);
});

test("epoch root is committed and a row's inclusion proof verifies on-chain", async () => {
  await new Promise((r) => setTimeout(r, 1100)); // let the 1-second epoch close
  const committed = await gw.epochs.runOnce();
  assert.ok(committed.length >= 1);
  const row = gw.db.usageById(rowId)!;

  const list = (await (await fetch(`${base}/epochs`)).json()) as { epochs: { epoch: number; txHash: string }[] };
  assert.ok(list.epochs.some((e) => e.epoch === row.epoch && e.txHash.startsWith("0x")));

  const p = (await (await fetch(`${base}/epochs/${row.epoch}/proof/${rowId}`)).json()) as {
    proof: Hex[];
    leafHash: Hex;
    root: Hex;
  };
  const registry = { address: dep.UsageRootRegistry, abi: usageRootRegistryAbi } as const;
  const onchainRoot = await testClient.readContract({ ...registry, functionName: "rootOf", args: [planId, BigInt(row.epoch)] });
  assert.equal(onchainRoot.toLowerCase(), p.root.toLowerCase());
  const ok = await testClient.readContract({
    ...registry,
    functionName: "verifyRow",
    args: [planId, BigInt(row.epoch), p.proof, p.leafHash],
  });
  assert.equal(ok, true);

  // JS StandardMerkleTree leaf encoding == Solidity hashRow (the contract can recompute the leaf itself).
  const onchainLeaf = await testClient.readContract({
    ...registry,
    functionName: "hashRow",
    args: [
      {
        epoch: BigInt(row.epoch),
        wallet: row.wallet as Hex,
        subId: BigInt(row.subId),
        model: row.model,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        requestHash: row.requestHash as Hex,
        responseHash: row.responseHash as Hex,
        timestamp: BigInt(row.timestamp),
      },
    ],
  });
  assert.equal(onchainLeaf, p.leafHash);

  // A tampered row does not verify.
  const bad = await testClient.readContract({
    ...registry,
    functionName: "verifyRow",
    args: [planId, BigInt(row.epoch), p.proof, ("0x" + "11".repeat(32)) as Hex],
  });
  assert.equal(bad, false);
});

test("cancelled subscription is entitled until paid-through, then 402", async () => {
  const hash = await wallet.writeContract({
    address: dep.SubscriptionVault,
    abi: subscriptionVaultAbi,
    functionName: "cancel",
    args: [subId],
  });
  await testClient.waitForTransactionReceipt({ hash });
  gw.entitlements.invalidate();
  assert.equal((await chat(jwt, {})).status, 200);

  const sub = await testClient.readContract({ address: dep.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "getSubscription", args: [subId] });
  const block = await testClient.getBlock();
  await testClient.increaseTime({ seconds: Number(sub.nextChargeAt - block.timestamp) + 1 });
  await testClient.mine({ blocks: 1 });
  gw.entitlements.invalidate();
  const r = await chat(jwt, {});
  assert.equal(r.status, 402);
  const j = (await r.json()) as { error: { status: string; subId: string } };
  assert.equal(j.error.status, "Cancelled");
  assert.equal(j.error.subId, subId.toString());
});

test("health reports mode, budget, epoch and cache", async () => {
  const h = (await (await fetch(`${base}/health`)).json()) as Record<string, any>;
  assert.equal(h.mode, "mock");
  assert.equal(h.liveBudget.remaining, cfg.maxLiveRequests);
  assert.ok(h.lastCommittedEpoch.epoch > 0);
  assert.ok(h.entitlementCacheSize >= 0);
});
