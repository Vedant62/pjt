"use client";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useBlockNumber } from "wagmi";
import { parseEventLogs, type Log } from "viem";
import { planRegistryAbi, subscriptionVaultAbi, usageRootRegistryAbi } from "@cashew/shared";
import { useDeployment, GATEWAY_URL, KEEPER_URL } from "./cashew";

export type Plan = {
  id: number;
  provider: `0x${string}`;
  payee: `0x${string}`;
  token: `0x${string}`;
  price: bigint;
  period: number;
  gracePeriod: number;
  active: boolean;
  metadataURI: string;
};

export function usePlans() {
  const client = usePublicClient();
  const { chainId, dep } = useDeployment();
  return useQuery({
    queryKey: ["plans", chainId],
    enabled: !!client && !!dep,
    refetchInterval: 10_000,
    queryFn: async (): Promise<Plan[]> => {
      const reg = { address: dep!.PlanRegistry, abi: planRegistryAbi } as const;
      const n = Number(await client!.readContract({ ...reg, functionName: "planCount" }));
      const plans = await Promise.all(
        Array.from({ length: n }, (_, i) => client!.readContract({ ...reg, functionName: "getPlan", args: [BigInt(i + 1)] })),
      );
      return plans.map((p, i) => ({ ...p, id: i + 1, price: BigInt(p.price), period: Number(p.period), gracePeriod: Number(p.gracePeriod) }));
    },
  });
}

export type Sub = {
  id: number;
  subscriber: `0x${string}`;
  planId: number;
  startedAt: number;
  nextChargeAt: number;
  pastDueSince: number;
  chargeCount: number;
  status: number;
};

export function useAllSubs() {
  const client = usePublicClient();
  const { chainId, dep } = useDeployment();
  return useQuery({
    queryKey: ["subs", chainId],
    enabled: !!client && !!dep,
    refetchInterval: 5_000,
    queryFn: async (): Promise<Sub[]> => {
      const vault = { address: dep!.SubscriptionVault, abi: subscriptionVaultAbi } as const;
      const n = Number(await client!.readContract({ ...vault, functionName: "subscriptionCount" }));
      const ids = Array.from({ length: Math.min(n, 500) }, (_, i) => n - i); // newest 500
      const subs = await Promise.all(ids.map((id) => client!.readContract({ ...vault, functionName: "getSubscription", args: [BigInt(id)] })));
      return subs.map((s, i) => ({
        id: ids[i],
        subscriber: s.subscriber,
        planId: Number(s.planId),
        startedAt: Number(s.startedAt),
        nextChargeAt: Number(s.nextChargeAt),
        pastDueSince: Number(s.pastDueSince),
        chargeCount: Number(s.chargeCount),
        status: Number(s.status),
      }));
    },
  });
}

const ALL_ABI = [...subscriptionVaultAbi, ...usageRootRegistryAbi, ...planRegistryAbi] as const;

/** All Cashew events since the deploy block (chunked getLogs; fine for a demo-sized deployment). */
export function useCashewLogs() {
  const client = usePublicClient();
  const { chainId, dep } = useDeployment();
  const { data: head } = useBlockNumber({ watch: true });
  return useQuery({
    queryKey: ["logs", chainId, head ? Number(head / 5n) : 0],
    enabled: !!client && !!dep && head !== undefined,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const from = BigInt(dep!.startBlock ?? 0);
      const to = head!;
      const CHUNK = 9_999n;
      const logs: Log[] = [];
      const addrs = [dep!.SubscriptionVault, dep!.UsageRootRegistry, dep!.PlanRegistry];
      // Cap history scanned on public RPCs (most recent ~200k blocks).
      const start = to - from > 200_000n ? to - 200_000n : from;
      for (let a = start; a <= to; a += CHUNK + 1n) {
        const b = a + CHUNK > to ? to : a + CHUNK;
        logs.push(...(await client!.getLogs({ address: addrs, fromBlock: a, toBlock: b })));
      }
      const parsed = parseEventLogs({ abi: ALL_ABI, logs });
      const blocks = new Map<bigint, number>();
      for (const bn of new Set(parsed.map((l) => l.blockNumber!))) {
        blocks.set(bn, Number((await client!.getBlock({ blockNumber: bn })).timestamp));
      }
      return parsed.map((l) => ({ ...l, timestamp: blocks.get(l.blockNumber!) ?? 0 }));
    },
  });
}

export function useHealth<T = any>(which: "gateway" | "keeper") {
  const url = which === "gateway" ? GATEWAY_URL : KEEPER_URL;
  return useQuery({
    queryKey: ["health", which],
    refetchInterval: 5_000,
    retry: false,
    queryFn: async (): Promise<T> => {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });
}

export function useGatewayEpochs() {
  return useQuery({
    queryKey: ["gw-epochs"],
    refetchInterval: 10_000,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`${GATEWAY_URL}/epochs`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as {
        planId: string;
        epochSeconds: number;
        currentEpoch: number;
        epochs: { epoch: number; root: string; rowCount: number; totalTokens: number; txHash: string; committedAt: number }[];
      };
    },
  });
}
