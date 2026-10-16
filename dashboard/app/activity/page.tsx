"use client";
import { useMemo, useState } from "react";
import { useWatchContractEvent } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { subscriptionVaultAbi, usageRootRegistryAbi } from "@cashew/shared";
import { AddressLink, NeedsDeployment, TxLink } from "@/components/ui";
import { fmtUsdc, useDeployment } from "@/lib/cashew";
import { useCashewLogs, usePlans } from "@/lib/hooks";

const KINDS = ["Subscribed", "Charged", "ChargeFailed", "SubscriptionLapsed", "Cancelled", "RootCommitted"] as const;
const COLOR: Record<string, string> = {
  Subscribed: "bg-sky-50 text-sky-800",
  Charged: "bg-emerald-50 text-emerald-800",
  ChargeFailed: "bg-amber-50 text-amber-800",
  SubscriptionLapsed: "bg-red-50 text-red-800",
  Cancelled: "bg-stone-100 text-stone-700",
  RootCommitted: "bg-violet-50 text-violet-800",
};

export default function ActivityPage() {
  const { dep } = useDeployment();
  const qc = useQueryClient();
  const logs = useCashewLogs();
  const plans = usePlans();
  const [filter, setFilter] = useState<Set<string>>(new Set(KINDS));

  // Live: any new vault / registry event triggers an immediate refresh of the feed.
  const refresh = () => qc.invalidateQueries({ queryKey: ["logs"] });
  useWatchContractEvent({ address: dep?.SubscriptionVault, abi: subscriptionVaultAbi, onLogs: refresh, enabled: !!dep });
  useWatchContractEvent({ address: dep?.UsageRootRegistry, abi: usageRootRegistryAbi, onLogs: refresh, enabled: !!dep });

  const period = useMemo(() => new Map((plans.data ?? []).map((p) => [p.id, p.period])), [plans.data]);
  const rows = useMemo(
    () =>
      ((logs.data ?? []) as any[])
        .filter((l) => filter.has(l.eventName))
        .sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex)
        .slice(0, 300),
    [logs.data, filter],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1>Activity</h1>
        <p className="mt-1 text-sm text-stone-600">Live on-chain event feed. Drift = block time of the charge − the scheduled time it was due.</p>
      </div>
      <NeedsDeployment>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => {
                const n = new Set(filter);
                n.has(k) ? n.delete(k) : n.add(k);
                setFilter(n);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${filter.has(k) ? COLOR[k] + " ring-transparent" : "bg-white text-stone-400 ring-stone-200"}`}
            >
              {k}
            </button>
          ))}
          <span className="ml-auto text-xs text-stone-500">{logs.isFetching ? "refreshing…" : `${rows.length} events`}</span>
        </div>
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2">Time</th>
                <th>Event</th>
                <th>Sub / epoch</th>
                <th>Details</th>
                <th>Keeper / actor</th>
                <th>Drift</th>
                <th className="pr-4">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const a = l.args;
                let detail = "",
                  who: string | null = null,
                  drift: string | null = null,
                  ref = a.subId !== undefined ? `#${a.subId}` : "";
                switch (l.eventName) {
                  case "Subscribed":
                    detail = `plan ${a.planId} · ${fmtUsdc(a.amount)} mUSDC`;
                    who = a.subscriber;
                    break;
                  case "Charged": {
                    detail = `${fmtUsdc(a.amount)} mUSDC · fee ${fmtUsdc(a.fee, 4)}`;
                    who = a.keeper;
                    const per = period.get(Number(a.planId));
                    if (per) drift = `${l.timestamp - (Number(a.newNextChargeAt) - per)} s`;
                    break;
                  }
                  case "ChargeFailed":
                    detail = `reason: ${a.reason === 1 ? "balance" : "allowance"} → PastDue`;
                    break;
                  case "SubscriptionLapsed":
                    detail = "grace expired unpaid → Lapsed";
                    break;
                  case "Cancelled":
                    detail = `paid through ${new Date(Number(a.paidThrough) * 1000).toLocaleTimeString()}`;
                    break;
                  case "RootCommitted":
                    ref = `epoch ${a.epoch}`;
                    detail = `${a.rowCount} rows · ${a.totalTokens} tokens · root ${String(a.root).slice(0, 10)}…`;
                    break;
                }
                return (
                  <tr key={`${l.transactionHash}-${l.logIndex}`} className="border-t border-stone-100">
                    <td className="whitespace-nowrap px-4 py-2 text-stone-500">{new Date(l.timestamp * 1000).toLocaleTimeString()}</td>
                    <td>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${COLOR[l.eventName]}`}>{l.eventName}</span>
                    </td>
                    <td className="mono">{ref}</td>
                    <td>{detail}</td>
                    <td>{who ? <AddressLink address={who} /> : <span className="text-stone-400">—</span>}</td>
                    <td className="tabular-nums">{drift ?? <span className="text-stone-400">—</span>}</td>
                    <td className="pr-4">
                      <TxLink hash={l.transactionHash} />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                    {logs.isLoading ? "Loading events…" : "No events yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </NeedsDeployment>
    </div>
  );
}
