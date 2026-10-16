"use client";
import { useEffect, useState } from "react";
import { useConfig } from "wagmi";
import { readContract } from "wagmi/actions";
import { useQuery } from "@tanstack/react-query";
import type { Hex } from "viem";
import { usageRootRegistryAbi } from "@cashew/shared";
import { NeedsDeployment, Notice, TxLink } from "@/components/ui";
import { GATEWAY_URL, decodeError, fmtDuration, short, useDeployment } from "@/lib/cashew";
import { useGatewayEpochs } from "@/lib/hooks";

type Proof = { planId: string; epoch: number; rowId: number; root: Hex; values: string[]; leaf: Record<string, string>; leafHash: Hex; proof: Hex[]; txHash: string | null };
type Verdict = { onchainRoot: Hex; rootMatches: boolean; recomputedLeaf: Hex; leafMatches: boolean; verified: boolean; tampered: boolean } | { error: string };

export default function EpochsPage() {
  const { dep } = useDeployment();
  const config = useConfig();
  const epochs = useGatewayEpochs();
  const [epoch, setEpoch] = useState<number | null>(null);
  const [rowId, setRowId] = useState<number | null>(null);
  const [tamper, setTamper] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (epoch === null && epochs.data?.epochs[0]) setEpoch(epochs.data.epochs[0].epoch);
  }, [epochs.data, epoch]);

  const rows = useQuery({
    queryKey: ["epoch-rows", epoch],
    enabled: epoch !== null,
    queryFn: async () => (await (await fetch(`${GATEWAY_URL}/epochs/${epoch}/rows`)).json()).rows as any[],
  });

  async function verify() {
    if (!dep || epoch === null || rowId === null) return;
    setBusy(true);
    setVerdict(null);
    try {
      const p = (await (await fetch(`${GATEWAY_URL}/epochs/${epoch}/proof/${rowId}`)).json()) as Proof;
      setProof(p);
      const reg = { address: dep.UsageRootRegistry, abi: usageRootRegistryAbi } as const;
      const planId = BigInt(p.planId);
      const v = p.values;
      // Optionally tamper: claim one more completion token than the gateway recorded.
      const row = {
        epoch: BigInt(v[0]),
        wallet: v[1] as Hex,
        subId: BigInt(v[2]),
        model: v[3],
        promptTokens: Number(v[4]),
        completionTokens: Number(v[5]) + (tamper ? 1 : 0),
        requestHash: v[6] as Hex,
        responseHash: v[7] as Hex,
        timestamp: BigInt(v[8]),
      };
      const [onchainRoot, recomputedLeaf] = await Promise.all([
        readContract(config, { ...reg, functionName: "rootOf", args: [planId, BigInt(epoch)] }),
        readContract(config, { ...reg, functionName: "hashRow", args: [row] }),
      ]);
      const verified = await readContract(config, { ...reg, functionName: "verifyRow", args: [planId, BigInt(epoch), p.proof, recomputedLeaf] });
      setVerdict({
        onchainRoot,
        rootMatches: onchainRoot.toLowerCase() === p.root.toLowerCase(),
        recomputedLeaf,
        leafMatches: recomputedLeaf === p.leafHash,
        verified,
        tampered: tamper,
      });
    } catch (e) {
      setVerdict({ error: decodeError(e).detail });
    } finally {
      setBusy(false);
    }
  }

  const list = epochs.data?.epochs ?? [];
  return (
    <div className="space-y-4">
      <div>
        <h1>Usage epochs</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Every {epochs.data ? fmtDuration(epochs.data.epochSeconds) : "epoch"}, the gateway builds a Merkle tree of its usage rows and commits the root on-chain. Pick a row, fetch its
          proof from the gateway, and check it against the on-chain root. The contract recomputes the leaf itself with <code className="mono">hashRow</code>.
        </p>
      </div>
      <NeedsDeployment>
        {epochs.isError && <Notice tone="error">Gateway unreachable at {GATEWAY_URL}.</Notice>}
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="card !p-0 lg:col-span-2">
            <div className="border-b border-stone-100 px-5 py-3">
              <h2>Committed roots</h2>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              {list.length === 0 && <p className="px-5 py-6 text-sm text-stone-400">No epochs committed yet (empty epochs are skipped).</p>}
              {list.map((e) => (
                <button
                  key={e.epoch}
                  onClick={() => {
                    setEpoch(e.epoch);
                    setRowId(null);
                    setVerdict(null);
                  }}
                  className={`block w-full border-b border-stone-100 px-5 py-3 text-left text-sm last:border-0 ${epoch === e.epoch ? "bg-cashew-50" : "hover:bg-stone-50"}`}
                >
                  <div className="flex justify-between">
                    <span className="font-medium">Epoch {e.epoch}</span>
                    <span className="text-xs text-stone-500">{new Date(e.committedAt * 1000).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500">
                    {e.rowCount} rows · {e.totalTokens} tokens · <span className="mono">{short(e.root, 6)}</span>
                  </div>
                  <div className="text-xs">
                    <TxLink hash={e.txHash} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 lg:col-span-3">
            <div className="card">
              <h2>Rows in epoch {epoch ?? "—"}</h2>
              <div className="mt-3 max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-stone-500">
                    <tr>
                      <th className="py-1" />
                      <th>Row</th>
                      <th>Wallet</th>
                      <th>Model</th>
                      <th>Tokens</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rows.data ?? []).map((r) => (
                      <tr key={r.id} className={`cursor-pointer border-t border-stone-100 ${rowId === r.id ? "bg-cashew-50" : "hover:bg-stone-50"}`} onClick={() => (setRowId(r.id), setVerdict(null))}>
                        <td className="py-1.5">
                          <input type="radio" readOnly checked={rowId === r.id} className="accent-cashew-600" />
                        </td>
                        <td>#{r.id}</td>
                        <td className="mono">{short(r.wallet)}</td>
                        <td>{r.model}</td>
                        <td className="tabular-nums">
                          {r.promptTokens}+{r.completionTokens}
                        </td>
                        <td className="text-stone-500">{new Date(r.timestamp * 1000).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <button className="btn-primary" disabled={rowId === null || busy} onClick={verify}>
                  {busy ? "Verifying…" : "Fetch proof & verify on-chain"}
                </button>
                <label className="flex items-center gap-2 text-sm text-stone-600">
                  <input type="checkbox" checked={tamper} onChange={(e) => (setTamper(e.target.checked), setVerdict(null))} className="accent-cashew-600" />
                  Tamper (+1 completion token)
                </label>
              </div>
            </div>

            {verdict && (
              <div className="card">
                {"error" in verdict ? (
                  <Notice tone="error">{verdict.error}</Notice>
                ) : (
                  <>
                    <div className={`flex items-center gap-3 text-xl font-semibold ${verdict.verified ? "text-emerald-700" : "text-red-700"}`}>
                      <span className={`grid h-10 w-10 place-items-center rounded-full text-2xl ${verdict.verified ? "bg-emerald-100" : "bg-red-100"}`}>{verdict.verified ? "✓" : "✗"}</span>
                      {verdict.verified ? "Row is included in the committed root" : verdict.tampered ? "Tampered row rejected" : "Proof does not verify"}
                    </div>
                    <dl className="mono mt-4 space-y-1 text-xs">
                      <div>
                        <span className="text-stone-500">on-chain root </span>
                        {verdict.onchainRoot} {verdict.rootMatches ? "✓ matches gateway" : "✗ differs"}
                      </div>
                      <div>
                        <span className="text-stone-500">leaf (hashRow) </span>
                        {verdict.recomputedLeaf} {verdict.leafMatches ? "✓ = gateway leaf" : "≠ gateway leaf"}
                      </div>
                      <div>
                        <span className="text-stone-500">proof length </span>
                        {proof?.proof.length}
                      </div>
                      {proof?.txHash && (
                        <div>
                          <span className="text-stone-500">commit tx </span>
                          <TxLink hash={proof.txHash} label={proof.txHash} />
                        </div>
                      )}
                    </dl>
                    {proof && (
                      <pre className="mono mt-3 overflow-x-auto rounded-lg bg-stone-900 p-3 text-[11px] text-stone-100">{JSON.stringify(proof.leaf, null, 2)}</pre>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </NeedsDeployment>
    </div>
  );
}
