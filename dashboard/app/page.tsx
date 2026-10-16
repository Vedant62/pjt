"use client";
import Link from "next/link";
import { useMemo } from "react";
import { AddressLink, NeedsDeployment, Stat, StatusBadge, TxLink, Row } from "@/components/ui";
import { fmtDuration, fmtUsdc, parseMetadata, short, useDeployment } from "@/lib/cashew";
import { useAllSubs, useCashewLogs, useHealth, usePlans } from "@/lib/hooks";

export default function Overview() {
  const { chainId, dep } = useDeployment();
  const plans = usePlans();
  const subs = useAllSubs();
  const logs = useCashewLogs();
  const gw = useHealth("gateway");
  const keeper = useHealth("keeper");

  const counters = useMemo(() => {
    const l = logs.data ?? [];
    let charged = 0n,
      chargeCount = 0,
      subscribed = 0n;
    let lastRoot: any = null;
    for (const e of l as any[]) {
      if (e.eventName === "Charged") (charged += e.args.amount), chargeCount++;
      if (e.eventName === "Subscribed") subscribed += e.args.amount;
      if (e.eventName === "RootCommitted") lastRoot = e;
    }
    const active = (subs.data ?? []).filter((s) => s.status === 1 || s.status === 2).length;
    return { charged, chargeCount, subscribed, lastRoot, active };
  }, [logs.data, subs.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1>Overview</h1>
        <p className="mt-1 text-sm text-stone-600">
          Recurring payments enforced by the contract: at most the plan price, at most once per period, triggered by any keeper. Chain {chainId}.
        </p>
      </div>
      <NeedsDeployment>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Active subscriptions" value={subs.data ? counters.active : "…"} sub="Active + PastDue" />
          <Stat label="Total collected" value={logs.data ? `${fmtUsdc(counters.charged + counters.subscribed)} mUSDC` : "…"} sub={`${counters.chargeCount} keeper charges`} />
          <Stat label="Plans" value={plans.data?.length ?? "…"} />
          <Stat
            label="Last usage root"
            value={counters.lastRoot ? `epoch ${counters.lastRoot.args.epoch}` : "—"}
            sub={counters.lastRoot ? <>{String(counters.lastRoot.args.rowCount)} rows · <TxLink hash={counters.lastRoot.transactionHash} /></> : "none committed yet"}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card">
            <h2>Contracts</h2>
            <div className="mt-3">
              {(["MockUSDC", "PlanRegistry", "SubscriptionVault", "UsageRootRegistry"] as const).map((k) => (
                <Row key={k} k={k}>
                  <AddressLink address={dep?.[k]} />
                </Row>
              ))}
              <Row k="Keeper fee">{dep ? `${dep.keeperFeeBps / 100}% of price` : "—"}</Row>
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <h2>Keeper</h2>
              <Health ok={keeper.isSuccess && keeper.data?.ok} err={keeper.isError} />
            </div>
            <div className="mt-3">
              {keeper.data ? (
                <>
                  <Row k="Address"><AddressLink address={keeper.data.keeper} /></Row>
                  <Row k="Tick">{fmtDuration(keeper.data.tickSeconds)}</Row>
                  <Row k="Last tick">{keeper.data.lastTickAt ? `${fmtDuration((Date.now() - keeper.data.lastTickAt) / 1000)} ago` : "—"}</Row>
                  <Row k="Queue (due now)">{keeper.data.queueSize}</Row>
                  <Row k="Fees earned (claimable)">{keeper.data.claimableFormatted} mUSDC</Row>
                </>
              ) : (
                <p className="text-sm text-stone-500">Keeper health endpoint unreachable. Anyone can run one: <code className="mono">pnpm --filter @cashew/keeper start</code></p>
              )}
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <h2>Gateway</h2>
              <Health ok={gw.isSuccess} err={gw.isError} />
            </div>
            <div className="mt-3">
              {gw.data ? (
                <>
                  <Row k="AIPG mode"><span className={gw.data.mode === "live" ? "font-semibold text-emerald-700" : ""}>{gw.data.mode}</span></Row>
                  <Row k="Live budget left">{gw.data.mode === "live" ? `${gw.data.liveBudget.remaining} / ${gw.data.liveBudget.max}` : "n/a (mock)"}</Row>
                  <Row k="Last committed epoch">{gw.data.lastCommittedEpoch ? gw.data.lastCommittedEpoch.epoch : "—"}</Row>
                  <Row k="Epoch length">{fmtDuration(gw.data.epochSeconds)}</Row>
                  <Row k="Entitlement cache">{gw.data.entitlementCacheSize} wallets</Row>
                </>
              ) : (
                <p className="text-sm text-stone-500">Gateway unreachable.</p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Plans</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-2">#</th>
                  <th>Name</th>
                  <th>Price</th>
                  <th>Period</th>
                  <th>Grace</th>
                  <th>Payee</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(plans.data ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-stone-100">
                    <td className="py-2">{p.id}</td>
                    <td>{parseMetadata(p.metadataURI).name ?? short(p.metadataURI, 10)}</td>
                    <td className="tabular-nums">{fmtUsdc(p.price)} mUSDC</td>
                    <td>{fmtDuration(p.period)}</td>
                    <td>{fmtDuration(p.gracePeriod)}</td>
                    <td><AddressLink address={p.payee} /></td>
                    <td><StatusBadge status={p.active ? "Active" : "Cancelled"} /></td>
                    <td className="text-right">
                      <Link href={`/plans/${p.id}`} className="text-cashew-700 hover:underline">Open →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </NeedsDeployment>
    </div>
  );
}

function Health({ ok, err }: { ok?: boolean; err?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${ok ? "text-emerald-700" : err ? "text-red-700" : "text-stone-500"}`}>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : err ? "bg-red-500" : "bg-stone-300"}`} />
      {ok ? "healthy" : err ? "down" : "…"}
    </span>
  );
}
