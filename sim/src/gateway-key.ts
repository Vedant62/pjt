/**
 * Ensure the test subscriber (LIFECYCLE_SUBSCRIBER_KEY) holds an entitled subscription to the demo plan on TESTNET_CHAIN,
 * sign in to the gateway with SIWE, mint a csk_ API key and store it as GATEWAY_API_KEY in sim/.env (never printed).
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { chainFor, getDeployment, mockUSDCAbi, subscriptionVaultAbi, DEFAULT_TESTNET } from "@cashew/shared";
import { ROOT } from "./lib/common";

const CHAIN_ID = Number(process.env.TESTNET_CHAIN ?? DEFAULT_TESTNET);
const RPC = CHAIN_ID === 84532 ? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org" : process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const GW = (process.env.GATEWAY_URL ?? "http://localhost:8787").replace(/\/$/, "");
const dep = getDeployment(CHAIN_ID);
const planId = BigInt(dep.demoPlanId ?? 1);
const account = privateKeyToAccount(process.env.LIFECYCLE_SUBSCRIBER_KEY as Hex);
const chain = chainFor(CHAIN_ID, RPC);
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ chain, account, transport: http(RPC) });
const send = async (req: any) => {
  const { request } = await pub.simulateContract({ ...req, account });
  await pub.waitForTransactionReceipt({ hash: await wallet.writeContract(request as any) });
};

let subId = await pub.readContract({ address: dep.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "entitledSubOf", args: [account.address, planId] });
if (subId === 0n) {
  await send({ address: dep.MockUSDC, abi: mockUSDCAbi, functionName: "mint", args: [account.address, 1_000_000_000n] });
  await send({ address: dep.MockUSDC, abi: mockUSDCAbi, functionName: "approve", args: [dep.SubscriptionVault, 2n ** 256n - 1n] });
  await send({ address: dep.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "subscribe", args: [planId] });
  subId = await pub.readContract({ address: dep.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "entitledSubOf", args: [account.address, planId] });
}
console.log(`subscriber ${account.address} entitled sub #${subId} on plan ${planId}`);

const { nonce } = await (await fetch(`${GW}/auth/nonce`)).json();
const message = createSiweMessage({ address: account.address, chainId: CHAIN_ID, domain: "localhost:3000", uri: "http://localhost:3000", nonce, version: "1", statement: "Cashew benchmark key" });
const v = await fetch(`${GW}/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature: await account.signMessage({ message }) }) });
if (!v.ok) throw new Error(`SIWE failed: ${await v.text()}`);
const { token } = await v.json();
const k = await fetch(`${GW}/keys`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
if (!k.ok) throw new Error(`key mint failed: ${await k.text()}`);
const { key } = await k.json();

const envPath = join(ROOT, "sim/.env");
const env = readFileSync(envPath, "utf8");
writeFileSync(envPath, /^GATEWAY_API_KEY=.*$/m.test(env) ? env.replace(/^GATEWAY_API_KEY=.*$/m, `GATEWAY_API_KEY=${key}`) : env + `\nGATEWAY_API_KEY=${key}\n`);
console.log("stored GATEWAY_API_KEY in sim/.env");
