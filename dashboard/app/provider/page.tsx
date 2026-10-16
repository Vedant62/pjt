"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { isAddress, parseUnits } from "viem";
import { planRegistryAbi, subscriptionVaultAbi } from "@cashew/shared";
import { AddressLink, NeedsDeployment, Notice, Row, StatusBadge, TxStatus, useTx } from "@/components/ui";
import { fmtDuration, fmtUsdc, parseMetadata, useDeployment } from "@/lib/cashew";
import { useAllSubs, usePlans } from "@/lib/hooks";

export default function ProviderPage() {
  const { dep } = useDeployment();
  const { address } = useAccount();
  const plans = usePlans();
  const subs = useAllSubs();
  const tx = useTx();

  const [form, setForm] = useState({
    token: "",
    price: "20",
    period: "180",
    grace: "60",
    payee: "",
    name: "My AI access plan",
    description: "",
  });
  useEffect(() => {
    if (dep && !form.token) setForm((f) => ({ ...f, token: dep.MockUSDC }));
    if (address && !form.payee) setForm((f) => ({ ...f, payee: address }));
  }, [dep, address]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = (plans.data ?? []).filter((p) => address && p.provider.toLowerCase() === address.toLowerCase());
  const payees = Array.from(new Set(mine.map((p) => p.payee)));
  const tokens = dep ? [dep.MockUSDC] : [];
  const claim = useReadContracts({
    allowFailure: false,
    contracts:
      dep && address
        ? [{ address: dep.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "claimable", args: [address, dep.MockUSDC] }]
        : [],
    query: { enabled: !!dep && !!address, refetchInterval: 4000 },
  });
  const claimable = (claim.data?.[0] as bigint | undefined) ?? undefined;

  const period = Number(form.period);
  const grace = Number(form.grace);
  const invalid =
    !isAddress(form.token) ? "token must be an address"
    : !isAddress(form.payee) ? "payee must be an address"
    : !(Number(form.price) > 0) ? "price must be > 0"
    : !(period > 0) ? "period must be > 0"
    : !(grace >= 0 && grace < period) ? "grace must be < period"
    : null;

  function create() {
    const meta = `data:application/json,${encodeURIComponent(JSON.stringify({ name: form.name, description: form.description }))}`;
    tx.send("Create plan", {
      address: dep!.PlanRegistry,
      abi: planRegistryAbi,
      functionName: "createPlan",
      args: [form.token as `0x${string}`, parseUnits(form.price, 6), period, grace, form.payee as `0x${string}`, meta],
    });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <div>
        <h1>Provider</h1>
        <p className="mt-1 text-sm text-stone-600">Publish a plan. Its price, period, token and payee are fixed forever once created.</p>
      </div>
      <NeedsDeployment>
        {!address && <Notice>Connect the provider wallet (locally: “Anvil #0 · provider”).</Notice>}
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="card lg:col-span-3">
            <h2>Create plan</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="label">Name</span>
                <input className="input" value={form.name} onChange={set("name")} />
              </label>
              <label className="sm:col-span-2">
                <span className="label">Description</span>
                <input className="input" value={form.description} onChange={set("description")} />
              </label>
              <label>
                <span className="label">Token</span>
                <input className="input mono" value={form.token} onChange={set("token")} />
              </label>
              <label>
                <span className="label">Price (token units, 6 dp)</span>
                <input className="input" value={form.price} onChange={set("price")} inputMode="decimal" />
              </label>
              <label>
                <span className="label">Period (seconds)</span>
                <input className="input" value={form.period} onChange={set("period")} inputMode="numeric" />
                <span className="mt-1 block text-xs text-stone-500">{period > 0 ? fmtDuration(period) : ""}</span>
              </label>
              <label>
                <span className="label">Grace (seconds, &lt; period)</span>
                <input className="input" value={form.grace} onChange={set("grace")} inputMode="numeric" />
                <span className="mt-1 block text-xs text-stone-500">{grace > 0 ? fmtDuration(grace) : ""}</span>
              </label>
              <label className="sm:col-span-2">
                <span className="label">Payee</span>
                <input className="input mono" value={form.payee} onChange={set("payee")} />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button className="btn-primary" disabled={!address || !!invalid || tx.busy} onClick={create}>
                Create plan
              </button>
              {invalid && <span className="text-xs text-red-700">{invalid}</span>}
            </div>
            <TxStatus state={tx.state} />
          </div>

          <div className="card lg:col-span-2">
            <h2>Revenue</h2>
            <p className="mb-3 text-xs text-stone-500">Each account withdraws only its own balance. Payees and keepers use the same call.</p>
            <Row k="Your claimable">{fmtUsdc(claimable)} mUSDC</Row>
            {payees.filter((p) => p.toLowerCase() !== address?.toLowerCase()).map((p) => (
              <Row key={p} k="Payee (other wallet)">
                <AddressLink address={p} />
              </Row>
            ))}
            <button
              className="btn-primary mt-4"
              disabled={!claimable || tx.busy}
              onClick={() => tx.send("Withdraw", { address: dep!.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "withdraw", args: [tokens[0]] })}
            >
              Withdraw
            </button>
          </div>
        </div>

        <div className="card">
          <h2>My plans</h2>
          {mine.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">{address ? "No plans created by this wallet." : "—"}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-2">#</th>
                    <th>Name</th>
                    <th>Price</th>
                    <th>Period / grace</th>
                    <th>Subscribers</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {mine.map((p) => {
                    const ps = (subs.data ?? []).filter((s) => s.planId === p.id);
                    const live = ps.filter((s) => s.status === 1 || s.status === 2).length;
                    return (
                      <tr key={p.id} className="border-t border-stone-100">
                        <td className="py-2">
                          <Link href={`/plans/${p.id}`} className="text-cashew-700 hover:underline">{p.id}</Link>
                        </td>
                        <td>{parseMetadata(p.metadataURI).name ?? "—"}</td>
                        <td className="tabular-nums">{fmtUsdc(p.price)}</td>
                        <td>{fmtDuration(p.period)} / {fmtDuration(p.gracePeriod)}</td>
                        <td>{live} live · {ps.length} total</td>
                        <td><StatusBadge status={p.active ? "Active" : "Cancelled"} /></td>
                        <td className="text-right">
                          <button
                            className="btn-secondary !py-1 text-xs"
                            disabled={tx.busy}
                            onClick={() => tx.send(p.active ? "Close plan" : "Reopen plan", { address: dep!.PlanRegistry, abi: planRegistryAbi, functionName: "setPlanActive", args: [BigInt(p.id), !p.active] })}
                          >
                            {p.active ? "Close to new subs" : "Reopen"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </NeedsDeployment>
    </div>
  );
}
