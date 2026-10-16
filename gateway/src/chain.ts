import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor, getDeployment, subscriptionVaultAbi, SubStatus, type Deployment } from "@cashew/shared";
import type { GatewayConfig } from "./config";

export interface Entitlement {
  wallet: Address;
  entitled: boolean;
  subId: bigint; // entitled sub, or the latest sub (for 402 detail), or 0
  status: (typeof SubStatus)[number];
  nextChargeAt: number | null;
  checkedAt: number;
}

export interface ChainCtx {
  chain: Chain;
  dep: Deployment;
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
}

export function makeChain(cfg: GatewayConfig): ChainCtx {
  const chain = chainFor(cfg.chainId, cfg.rpcUrl);
  const account = privateKeyToAccount(cfg.gatewayKey);
  return {
    chain,
    dep: getDeployment(cfg.chainId),
    publicClient: createPublicClient({ chain, transport: http(cfg.rpcUrl, { batch: true }) }),
    walletClient: createWalletClient({ chain, account, transport: http(cfg.rpcUrl) }),
  };
}

/** On-chain entitlement with a short in-memory TTL cache (default 15 s). */
export class EntitlementCache {
  private cache = new Map<string, Entitlement>();
  constructor(
    private ctx: ChainCtx,
    private planId: bigint,
    private ttlMs: number,
  ) {}

  get size() {
    return this.cache.size;
  }

  invalidate(wallet?: string) {
    if (wallet) this.cache.delete(wallet.toLowerCase());
    else this.cache.clear();
  }

  async check(wallet: Address): Promise<{ ent: Entitlement; cached: boolean; ms: number }> {
    const t0 = performance.now();
    const key = wallet.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.checkedAt < this.ttlMs) return { ent: hit, cached: true, ms: performance.now() - t0 };
    const ent = await this.fetch(wallet);
    this.cache.set(key, ent);
    return { ent, cached: false, ms: performance.now() - t0 };
  }

  private async fetch(wallet: Address): Promise<Entitlement> {
    const { publicClient, dep } = this.ctx;
    const vault = { address: dep.SubscriptionVault, abi: subscriptionVaultAbi } as const;
    // entitledSubOf performs the isEntitled() check on-chain and returns 0 when not entitled.
    const [entitledSub, latestSub] = await Promise.all([
      publicClient.readContract({ ...vault, functionName: "entitledSubOf", args: [wallet, this.planId] }),
      publicClient.readContract({ ...vault, functionName: "latestSubOf", args: [wallet, this.planId] }),
    ]);
    const subId = entitledSub !== 0n ? entitledSub : latestSub;
    if (subId === 0n) return { wallet, entitled: false, subId, status: "None", nextChargeAt: null, checkedAt: Date.now() };
    const sub = await publicClient.readContract({ ...vault, functionName: "getSubscription", args: [subId] });
    return {
      wallet,
      entitled: entitledSub !== 0n,
      subId,
      status: SubStatus[sub.status],
      nextChargeAt: Number(sub.nextChargeAt),
      checkedAt: Date.now(),
    };
  }
}
