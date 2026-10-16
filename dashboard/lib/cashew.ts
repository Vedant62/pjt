"use client";
import { useChainId, useBlock } from "wagmi";
import { useEffect, useState } from "react";
import { addresses, EXPLORERS, type Deployment } from "@cashew/shared";
import { BaseError, ContractFunctionRevertedError, formatUnits } from "viem";

export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8787";
export const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? "http://localhost:8788";

export function useDeployment(): { chainId: number; dep: Deployment | null } {
  const chainId = useChainId();
  return { chainId, dep: (addresses[String(chainId)] as Deployment | undefined) ?? null };
}

export function explorer(chainId: number) {
  return EXPLORERS[chainId] ?? null;
}

export const fmtUsdc = (v: bigint | undefined | null, digits = 2) =>
  v === undefined || v === null ? "—" : Number(formatUnits(v, 6)).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const short = (a?: string | null, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : "—");

export function fmtDuration(sec: number) {
  const s = Math.abs(Math.round(sec));
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** Chain time (latest block timestamp) extrapolated with the wall clock, so countdowns stay correct on warped anvil chains. */
export function useChainNow() {
  const { data: block } = useBlock({ watch: true });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (block) setOffset(Number(block.timestamp) - Math.floor(Date.now() / 1000));
  }, [block]);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now + offset;
}

/** Decode a viem error into "ErrorName(args)" for display. */
export function decodeError(e: unknown): { name: string; detail: string } {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) {
      const args = (revert.data.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
      return { name: revert.data.errorName, detail: `${revert.data.errorName}(${args.join(", ")})` };
    }
    if (revert?.reason) return { name: "Error", detail: revert.reason };
    return { name: e.name, detail: e.shortMessage };
  }
  return { name: "Error", detail: e instanceof Error ? e.message : String(e) };
}

export const STATUS = ["None", "Active", "PastDue", "Lapsed", "Cancelled"] as const;

export function parseMetadata(uri: string): { name?: string; description?: string; features?: string[] } {
  try {
    if (uri.startsWith("data:application/json,")) return JSON.parse(decodeURIComponent(uri.slice("data:application/json,".length)));
    if (uri.trim().startsWith("{")) return JSON.parse(uri);
  } catch {}
  return { name: uri || undefined };
}
