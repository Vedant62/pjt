"use client";
import { useMemo, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { simulateContract, writeContract, getPublicClient } from "wagmi/actions";
import { parseUnits, type Abi } from "viem";
import { mockUSDCAbi, planRegistryAbi, subscriptionVaultAbi } from "@cashew/shared";
import { AddressLink, NeedsDeployment, Notice, TxLink } from "@/components/ui";
import { decodeError, short, useChainNow, useDeployment } from "@/lib/cashew";
import { useAllSubs, type Sub } from "@/lib/hooks";

type Result = { blocked: boolean; error?: string; hash?: string; onchainStatus?: string; note?: string };

type Attack = {
  id: string;
  title: string;
  test: string;
  what: string;
  expect: string;
  needs: "sub-early" | "sub-charged" | "sub-cancelled" | "victim" | "none";
  call: (ctx: { sub?: Sub; dep: any; attacker: `0x${string}` }) => { address: `0x${string}`; abi: Abi; functionName: string; args: readonly unknown[] };
};

const ATTACKS: Attack[] = [
  {
    id: "early",
    title: "1 · Charge early",
    test: "test_KeeperCannot_ChargeEarly",
    what: "Call charge(subId) before the subscription's nextChargeAt.",
    expect: "NotDue()",
    needs: "sub-early",
    call: ({ sub, dep }) => ({ address: dep.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "charge", args: [BigInt(sub!.id)] }),
  },
  {
    id: "twice",
    title: "2 · Charge twice in one period",
    test: "test_KeeperCannot_ChargeTwiceInPeriod",
    what: "Call charge(subId) again on a subscription that has already been paid for the current period.",
    expect: "NotDue()",
    needs: "sub-charged",
    call: ({ sub, dep }) => ({ address: dep.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "charge", args: [BigInt(sub!.id)] }),
  },
  {
    id: "cancelled",
    title: "3 · Charge a cancelled subscription",
    test: "test_KeeperCannot_ChargeCancelled",
    what: "Call charge(subId) on a subscription the subscriber cancelled.",
    expect: "NotChargeable(4)  (4 = Cancelled)",
    needs: "sub-cancelled",
    call: ({ sub, dep }) => ({ address: dep.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "charge", args: [BigInt(sub!.id)] }),
  },
  {
    id: "pull",
    title: "4 · Pull more than the price",
    test: "test_KeeperCannot_PullMoreThanPrice",
    what: "The vault has no amount parameter, so the only way to take more is token.transferFrom(subscriber, attacker, 1000 mUSDC) directly. The subscriber approved the vault, not the attacker.",
    expect: "ERC20InsufficientAllowance(attacker, 0, 1000000000)",
    needs: "victim",
    call: ({ sub, dep, attacker }) => ({ address: dep.MockUSDC, abi: mockUSDCAbi, functionName: "transferFrom", args: [sub!.subscriber, attacker, parseUnits("1000", 6)] }),
  },
  {
    id: "redirect",
    title: "5 · Redirect the payee's funds",
    test: "test_KeeperCannot_RedirectPayeeFunds",
    what: "withdraw() only ever pays msg.sender's own balance, and neither contract has a payee setter. The attacker tries withdraw(mUSDC).",
    expect: "NothingToWithdraw()",
    needs: "none",
    call: ({ dep }) => ({ address: dep.SubscriptionVault, abi: subscriptionVaultAbi, functionName: "withdraw", args: [dep.MockUSDC] }),
  },
];

export default function AttacksPage() {
  const { dep } = useDeployment();
  const { address } = useAccount();
  const config = useConfig();
  const subs = useAllSubs();
  const now = useChainNow();
  const [real, setReal] = useState(false);
  const [results, setResults] = useState<Record<string, Result | "running">>({});
  const [override, setOverride] = useState<Record<string, string>>({});

  const targets = useMemo(() => {
    const all = subs.data ?? [];
    const live = all.filter((s) => s.status === 1 && s.nextChargeAt > now);
    return {
      "sub-early": live[0],
      "sub-charged": live.find((s) => s.chargeCount >= 2) ?? live[0],
      "sub-cancelled": all.find((s) => s.status === 4),
      victim: all.find((s) => s.status === 1 || s.status === 2),
      none: undefined,
    } as Record<Attack["needs"], Sub | undefined>;
  }, [subs.data, now]);

  const payeeSetters = useMemo(
    () =>
      [...planRegistryAbi, ...subscriptionVaultAbi]
        .filter((f: any) => f.type === "function" && /payee/i.test(f.name) && f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f: any) => f.name),
    [],
  );

  async function run(a: Attack) {
    if (!address || !dep) return;
    const ov = override[a.id];
    const sub = ov ? (subs.data ?? []).find((s) => s.id === Number(ov)) : targets[a.needs];
    if (a.needs !== "none" && !sub) {
      setResults((r) => ({ ...r, [a.id]: { blocked: false, note: "No suitable target subscription found. Create one on a plan page first." } }));
      return;
    }
    setResults((r) => ({ ...r, [a.id]: "running" }));
    const params = a.call({ sub, dep, attacker: address });
    let res: Result;
    try {
      await simulateContract(config, { ...(params as any), account: address });
      res = { blocked: false, note: "Simulation SUCCEEDED — the attack was not blocked for this target." };
    } catch (e) {
      res = { blocked: true, error: decodeError(e).detail };
    }
    if (real && res.blocked) {
      try {
        // "prepared" skips wagmi's pre-simulation and explicit gas skips estimation (both would fail), so the
        // reverting tx is actually broadcast and is visible on the explorer.
        const hash = await writeContract(config, { ...(params as any), gas: 300_000n, __mode: "prepared" });
        // viem's receipt wait (wagmi's throws on reverted receipts, but a revert is the expected outcome here).
        const rc = await getPublicClient(config)!.waitForTransactionReceipt({ hash });
        res = { ...res, hash, onchainStatus: rc.status };
      } catch (e) {
        res = { ...res, note: `Broadcast failed: ${decodeError(e).detail}` };
      }
    }
    setResults((r) => ({ ...r, [a.id]: res }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Attack panel</h1>
          <p className="mt-1 max-w-3xl text-sm text-stone-600">
            The keeper is untrusted and permissionless, so anyone can act as one. Each button runs one of the five attacks from the connected wallet. It simulates the call and shows the
            decoded custom error. Each attack matches a named Foundry test.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} className="h-4 w-4 accent-cashew-600" />
          Send for real (broadcast the reverting tx)
        </label>
      </div>
      <NeedsDeployment>
        {!address ? (
          <Notice>Connect the attacker wallet (locally: “Anvil #5 · attacker”).</Notice>
        ) : (
          <Notice>
            Attacking as <AddressLink address={address} />. Use a wallet that is not the subscriber or payee, so the results reflect an outsider.
          </Notice>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {ATTACKS.map((a) => {
            const r = results[a.id];
            const t = override[a.id] ? (subs.data ?? []).find((s) => s.id === Number(override[a.id])) : targets[a.needs];
            return (
              <div key={a.id} className="card flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h2>{a.title}</h2>
                  <code className="mono rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600">{a.test}</code>
                </div>
                <p className="mt-2 text-sm text-stone-600">{a.what}</p>
                <div className="mt-2 text-xs text-stone-500">
                  Expected revert: <code className="mono text-stone-800">{a.expect}</code>
                </div>
                {a.needs !== "none" && (
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="text-stone-500">Target:</span>
                    {t ? (
                      <span>
                        sub #{t.id} · subscriber {short(t.subscriber)}
                      </span>
                    ) : (
                      <span className="text-amber-700">none found</span>
                    )}
                    <input
                      className="input !w-20 !py-1 text-xs"
                      placeholder="sub id"
                      value={override[a.id] ?? ""}
                      onChange={(e) => setOverride({ ...override, [a.id]: e.target.value.replace(/\D/g, "") })}
                    />
                  </div>
                )}
                {a.id === "redirect" && (
                  <div className="mt-2 text-xs text-stone-500">
                    Payee-mutating functions in the ABIs: <span className="font-semibold text-stone-800">{payeeSetters.length ? payeeSetters.join(", ") : "none"}</span>
                  </div>
                )}
                <div className="mt-auto pt-4">
                  <button className="btn-danger" disabled={!address || r === "running"} onClick={() => run(a)}>
                    {r === "running" ? "Running…" : "Run attack"}
                  </button>
                  {r && r !== "running" && (
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${r.blocked ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                      {r.blocked ? (
                        <>
                          <div className="font-semibold text-emerald-800">✓ Blocked by the contract</div>
                          <div className="mono mt-1 text-emerald-900">{r.error}</div>
                        </>
                      ) : (
                        <div className="font-semibold text-red-800">{r.note}</div>
                      )}
                      {r.hash && (
                        <div className="mt-1 text-xs text-stone-600">
                          Broadcast: <TxLink hash={r.hash} /> · status <b>{r.onchainStatus}</b>
                        </div>
                      )}
                      {r.blocked && r.note && <div className="mt-1 text-xs text-stone-600">{r.note}</div>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </NeedsDeployment>
    </div>
  );
}

