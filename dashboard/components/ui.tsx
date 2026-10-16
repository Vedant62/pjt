"use client";
import { useState, type ReactNode } from "react";
import { useAccount, useConfig } from "wagmi";
import { simulateContract, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import type { Abi, Hash } from "viem";
import { decodeError, explorer, short, STATUS, useDeployment } from "@/lib/cashew";

export function TxLink({ hash, label }: { hash?: string | null; label?: string }) {
  const { chainId } = useDeployment();
  const ex = explorer(chainId);
  if (!hash || hash === "0x") return <span className="text-stone-400">—</span>;
  const text = label ?? short(hash, 6);
  return ex ? (
    <a href={`${ex}/tx/${hash}`} target="_blank" rel="noreferrer" className="mono text-cashew-700 underline decoration-dotted hover:text-cashew-900">
      {text}
    </a>
  ) : (
    <span className="mono text-stone-700" title={hash}>
      {text}
    </span>
  );
}

export function AddressLink({ address, full }: { address?: string | null; full?: boolean }) {
  const { chainId } = useDeployment();
  const ex = explorer(chainId);
  if (!address) return <span className="text-stone-400">—</span>;
  const text = full ? address : short(address);
  return ex ? (
    <a href={`${ex}/address/${address}`} target="_blank" rel="noreferrer" className="mono text-cashew-700 underline decoration-dotted hover:text-cashew-900">
      {text}
    </a>
  ) : (
    <span className="mono" title={address}>
      {text}
    </span>
  );
}

const BADGE: Record<string, string> = {
  None: "bg-stone-100 text-stone-600",
  Active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PastDue: "bg-amber-50 text-amber-800 ring-amber-200",
  Lapsed: "bg-red-50 text-red-700 ring-red-200",
  Cancelled: "bg-stone-100 text-stone-700 ring-stone-300",
};

export function StatusBadge({ status }: { status: number | string }) {
  const name = typeof status === "number" ? STATUS[status] : status;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[name] ?? BADGE.None}`}>{name}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-stone-100 py-2 text-sm last:border-0">
      <span className="text-stone-500">{k}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

type TxState = { status: "idle" | "pending" | "mining" | "success" | "error"; label?: string; hash?: Hash; error?: string };

/** simulate → write → wait, with decoded custom errors and a query refresh on success. */
export function useTx() {
  const config = useConfig();
  const { address } = useAccount();
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>({ status: "idle" });

  async function send<const A extends Abi>(label: string, params: { address: `0x${string}`; abi: A; functionName: string; args?: readonly unknown[] }) {
    setState({ status: "pending", label });
    try {
      const { request } = await simulateContract(config, { ...(params as any), account: address });
      const hash = await writeContract(config, request as any);
      setState({ status: "mining", label, hash });
      const rc = await waitForTransactionReceipt(config, { hash });
      if (rc.status !== "success") throw new Error("transaction reverted");
      setState({ status: "success", label, hash });
      await qc.invalidateQueries();
      return hash;
    } catch (e) {
      setState((s) => ({ status: "error", label, hash: s.hash, error: decodeError(e).detail }));
      return null;
    }
  }
  return { state, send, busy: state.status === "pending" || state.status === "mining", reset: () => setState({ status: "idle" }) };
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.status === "idle") return null;
  const tone = state.status === "error" ? "text-red-700" : state.status === "success" ? "text-emerald-700" : "text-stone-600";
  const msg = { pending: "waiting for signature…", mining: "mining…", success: "confirmed", error: state.error }[state.status];
  return (
    <div className={`mt-2 text-xs ${tone}`}>
      <span className="font-medium">{state.label}:</span> {msg} {state.hash && <TxLink hash={state.hash} />}
    </div>
  );
}

export function Countdown({ target, now }: { target: number; now: number }) {
  const d = target - now;
  const s = Math.abs(d);
  const txt = s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
  return <span className={`tabular-nums ${d < 0 ? "text-amber-700" : ""}`}>{d >= 0 ? `in ${txt}` : `${txt} overdue`}</span>;
}

export function NeedsDeployment({ children }: { children: ReactNode }) {
  const { chainId, dep } = useDeployment();
  if (!dep)
    return (
      <Notice tone="warn">
        No Cashew deployment for chain {chainId}. Switch network, or run <code className="mono">pnpm local:up</code> / <code className="mono">pnpm deploy:testnet</code>.
      </Notice>
    );
  return <>{children}</>;
}
