"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAccount, useConfig, useReadContract, useReadContracts, useSignTypedData } from "wagmi";
import { readContract } from "wagmi/actions";
import { parseSignature, parseUnits } from "viem";
import { mockUSDCAbi, planRegistryAbi, subscriptionVaultAbi } from "@cashew/shared";
import { AddressLink, Countdown, NeedsDeployment, Notice, Row, StatusBadge, TxStatus, useTx } from "@/components/ui";
import { decodeError, fmtDuration, fmtUsdc, parseMetadata, useChainNow, useDeployment } from "@/lib/cashew";

const DEAD = "0x000000000000000000000000000000000000dEaD";

export default function PlanPage() {
  const params = useParams<{ id: string }>();
  const planId = BigInt(params.id);
  const { chainId, dep } = useDeployment();
  const { address } = useAccount();
  const now = useChainNow();
  const tx = useTx();
  const { signTypedDataAsync } = useSignTypedData();
  const config = useConfig();
  const [subErr, setSubErr] = useState<string | null>(null);

  const plan = useReadContract({
    address: dep?.PlanRegistry,
    abi: planRegistryAbi,
    functionName: "getPlan",
    args: [planId],
    query: { enabled: !!dep },
  });
  const p = plan.data;
  const vault = dep ? ({ address: dep.SubscriptionVault, abi: subscriptionVaultAbi } as const) : undefined;
  const token = p ? ({ address: p.token, abi: mockUSDCAbi } as const) : undefined;

  const user = useReadContracts({
    allowFailure: false,
    contracts:
      address && vault && token
        ? [
            { ...vault, functionName: "latestSubOf", args: [address, planId] },
            { ...token, functionName: "balanceOf", args: [address] },
            { ...token, functionName: "allowance", args: [address, vault.address] },
          ]
        : [],
    query: { enabled: !!address && !!vault && !!token, refetchInterval: 3000 },
  });
  const [latestSubId, balance, allowance] = (user.data ?? []) as [bigint?, bigint?, bigint?];

  const sub = useReadContracts({
    allowFailure: false,
    contracts: vault && latestSubId ? [
      { ...vault, functionName: "getSubscription", args: [latestSubId] },
      { ...vault, functionName: "isEntitled", args: [latestSubId] },
    ] : [],
    query: { enabled: !!vault && !!latestSubId, refetchInterval: 3000 },
  });
  const [s, entitled] = (sub.data ?? []) as [any, boolean?];

  const meta = p ? parseMetadata(p.metadataURI) : {};
  const price = p ? BigInt(p.price) : 0n;
  const UNLIMITED = 2n ** 255n; // e.g. approve(maxUint256) from scripts
  const unlimited = allowance !== undefined && allowance >= UNLIMITED;
  const cycles = price > 0n && allowance !== undefined && !unlimited ? allowance / price : undefined;
  const live = s && (s.status === 1 || s.status === 2);

  async function subscribe() {
    if (!p || !dep || !address || !vault) return;
    setSubErr(null);
    try {
      const value = price * 12n; // 12 cycles; the vault still never pulls more than `price` per period
      const deadline = BigInt(now + 3600);
      const [nonce, name] = await Promise.all([
        readContract(config, { address: p.token, abi: mockUSDCAbi, functionName: "nonces", args: [address] }),
        readContract(config, { address: p.token, abi: mockUSDCAbi, functionName: "name" }),
      ]);
      const sig = await signTypedDataAsync({
        domain: { name, version: "1", chainId, verifyingContract: p.token },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: { owner: address, spender: dep.SubscriptionVault, value, nonce, deadline },
      });
      const { v, r, s: ss } = parseSignature(sig);
      await tx.send("Subscribe", { ...vault, functionName: "subscribeWithPermit", args: [planId, value, deadline, Number(v), r, ss] });
    } catch (e) {
      setSubErr(decodeError(e).detail);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-stone-500">Plan #{params.id}</div>
          <h1>{meta.name ?? "Plan"}</h1>
          {meta.description && <p className="mt-1 max-w-2xl text-sm text-stone-600">{meta.description}</p>}
        </div>
        {p && !p.active && <Notice tone="warn">This plan is closed to new subscriptions.</Notice>}
      </div>
      <NeedsDeployment>
        {plan.isError && <Notice tone="error">Plan {params.id} does not exist on chain {chainId}.</Notice>}
        {p && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card">
              <h2>Terms</h2>
              <p className="mb-2 text-xs text-stone-500">Immutable: the registry has no setter for price, period, token or payee.</p>
              <Row k="Price">{fmtUsdc(price)} mUSDC / period</Row>
              <Row k="Period">{fmtDuration(Number(p.period))}</Row>
              <Row k="Grace">{fmtDuration(Number(p.gracePeriod))}</Row>
              <Row k="Token"><AddressLink address={p.token} /></Row>
              <Row k="Payee"><AddressLink address={p.payee} /></Row>
              <Row k="Provider"><AddressLink address={p.provider} /></Row>
              {meta.features && <Row k="Models">{meta.features.join(", ")}</Row>}
            </div>

            <div className="card">
              <h2>Your wallet</h2>
              {!address ? (
                <p className="mt-3 text-sm text-stone-500">Connect a wallet to subscribe.</p>
              ) : (
                <>
                  <div className="mt-3">
                    <Row k="mUSDC balance">{fmtUsdc(balance)}</Row>
                    <Row k="Vault allowance">{unlimited ? "unlimited" : fmtUsdc(allowance)} {cycles !== undefined && <span className="text-stone-500">({cycles.toString()} cycles)</span>}</Row>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="btn-secondary" disabled={tx.busy} onClick={() => tx.send("Mint 100 mUSDC", { address: p.token, abi: mockUSDCAbi, functionName: "mint", args: [address, parseUnits("100", 6)] })}>
                      Get test mUSDC
                    </button>
                    {!live && (
                      <button className="btn-primary" disabled={tx.busy || !p.active || (balance ?? 0n) < price} onClick={subscribe}>
                        Subscribe · 1 signature + 1 tx
                      </button>
                    )}
                  </div>
                  {!live && (balance ?? 0n) < price && <p className="mt-2 text-xs text-stone-500">You need at least {fmtUsdc(price)} mUSDC; the first period is paid on subscribe.</p>}
                  {subErr && <p className="mt-2 text-xs text-red-700">{subErr}</p>}
                  <TxStatus state={tx.state} />
                </>
              )}
            </div>

            <div className="card">
              <div className="flex items-center justify-between">
                <h2>Subscription</h2>
                {s && <StatusBadge status={Number(s.status)} />}
              </div>
              {!s ? (
                <p className="mt-3 text-sm text-stone-500">{address ? "Not subscribed." : "—"}</p>
              ) : (
                <>
                  <div className="mt-3">
                    <Row k="Sub id">#{latestSubId?.toString()}</Row>
                    <Row k="Entitled">
                      <span className={entitled ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>{entitled ? "yes" : "no"}</span>
                    </Row>
                    <Row k={Number(s.status) === 4 ? "Paid through" : "Next charge"}>
                      <Countdown target={Number(s.nextChargeAt)} now={now} />
                    </Row>
                    {Number(s.status) === 2 && (
                      <Row k="Grace ends">
                        <Countdown target={Number(s.nextChargeAt) + Number(p.gracePeriod)} now={now} />
                      </Row>
                    )}
                    <Row k="Charges">{s.chargeCount.toString()}</Row>
                    <Row k="Allowance cycles left">{unlimited ? "unlimited" : cycles?.toString() ?? "—"}</Row>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {live && (
                      <button className="btn-danger" disabled={tx.busy} onClick={() => tx.send("Cancel", { ...vault!, functionName: "cancel", args: [latestSubId!] })}>
                        Cancel
                      </button>
                    )}
                    <button className="btn-secondary" disabled={tx.busy} onClick={() => tx.send("Re-approve 12 cycles", { address: p.token, abi: mockUSDCAbi, functionName: "approve", args: [dep!.SubscriptionVault, price * 12n] })}>
                      Top up / re-approve
                    </button>
                    {live && (
                      <button
                        className="btn-secondary text-stone-500"
                        title="Demo helper: send your whole balance away to trigger ChargeFailed"
                        disabled={tx.busy || !balance}
                        onClick={() => tx.send("Drain balance (demo)", { address: p.token, abi: mockUSDCAbi, functionName: "transfer", args: [DEAD, balance!] })}
                      >
                        Drain balance (demo)
                      </button>
                    )}
                  </div>
                  {Number(s.status) === 2 && (
                    <Notice tone="warn">
                      <div className="mt-3">Payment failed. You keep access during grace; top up (mint) before it ends and the next keeper tick recovers the subscription.</div>
                    </Notice>
                  )}
                  <p className="mt-3 text-xs text-stone-500">
                    Use the API at <Link className="text-cashew-700 underline" href="/chat">/chat</Link>. Entitled = Active/PastDue within grace, or Cancelled until paid-through.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </NeedsDeployment>
    </div>
  );
}
