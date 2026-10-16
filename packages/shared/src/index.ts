import addressesJson from "./addresses";

export * from "./abis";

export type Address = `0x${string}`;

export interface Deployment {
  MockUSDC: Address;
  PlanRegistry: Address;
  SubscriptionVault: Address;
  UsageRootRegistry: Address;
  gateway: Address;
  deployer: Address;
  keeperFeeBps: number;
  startBlock: number;
  demoPlanId: number | null;
  prodPlanId: number | null;
}

export const addresses = addressesJson as unknown as Record<string, Deployment>;

export const CHAIN_IDS = { anvil: 31337, baseSepolia: 84532, sepolia: 11155111 } as const;

/** Default public testnet (Ethereum Sepolia; Base Sepolia remains supported). */
export const DEFAULT_TESTNET = CHAIN_IDS.sepolia;

export const EXPLORERS: Record<number, string | null> = {
  31337: null,
  84532: "https://sepolia.basescan.org",
  11155111: "https://sepolia.etherscan.io",
};

export function getDeployment(chainId: number): Deployment {
  const d = addresses[String(chainId)];
  if (!d) throw new Error(`No Cashew deployment for chainId ${chainId}. Run the deploy script and \`pnpm sync:abis\`.`);
  return d;
}

/** Mirrors SubscriptionVault.Status */
export const SubStatus = ["None", "Active", "PastDue", "Lapsed", "Cancelled"] as const;
export type SubStatusName = (typeof SubStatus)[number];

/** ChargeFailed.reason */
export const ChargeFailReason: Record<number, string> = { 1: "balance", 2: "allowance" };

/** StandardMerkleTree leaf encoding for usage rows (must match UsageRootRegistry.hashRow). */
export const USAGE_LEAF_TYPES = [
  "uint64",
  "address",
  "uint256",
  "string",
  "uint32",
  "uint32",
  "bytes32",
  "bytes32",
  "uint64",
] as const;
export const USAGE_LEAF_FIELDS = [
  "epoch",
  "wallet",
  "subId",
  "model",
  "promptTokens",
  "completionTokens",
  "requestHash",
  "responseHash",
  "timestamp",
] as const;

/** Well-known anvil dev accounts used by the local stack (NOT secrets; public test keys). */
export const ANVIL_ACCOUNTS = {
  deployer: { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  keeper: { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
  gateway: { address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
  subscriber1: { address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
  subscriber2: { address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" },
  attacker: { address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", key: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" },
} as const;

import { defineChain, type Chain } from "viem";
import { baseSepolia, foundry, sepolia } from "viem/chains";

/** viem chain object for a chainId, optionally overriding the RPC URL. */
export function chainFor(chainId: number, rpcUrl?: string): Chain {
  const base = chainId === 84532 ? baseSepolia : chainId === 11155111 ? sepolia : chainId === 31337 ? foundry : null;
  if (!base) throw new Error(`Unsupported chainId ${chainId}`);
  if (!rpcUrl) return base;
  return defineChain({ ...base, rpcUrls: { default: { http: [rpcUrl] } } });
}
