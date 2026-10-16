"""Report figures drawn from results/*.json (no hand-entered numbers)."""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
R = os.path.join(os.path.dirname(__file__), "..", "..", "results"); O = os.path.join(os.path.dirname(__file__), "..", "figures")
os.makedirs(O, exist_ok=True)
S = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]; INK = "#1f1f1e"; MUTED = "#6b6a63"
plt.rcParams.update({"font.family": "Times New Roman", "font.size": 11, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.color": "#e6e5df", "grid.linewidth": 0.6, "savefig.facecolor": "white"})
J = lambda f: json.load(open(os.path.join(R, f)))
def save(fig, n): fig.savefig(os.path.join(O, n), dpi=300, bbox_inches="tight"); plt.close(fig); print("wrote", n)

# Gas per operation (median execution gas, unit tests)
g = J("gas_report.json")["ops"]; ks = list(g)
fig, ax = plt.subplots(figsize=(6.4, 3.0))
ax.barh(ks[::-1], [g[k]["median"] / 1000 for k in ks[::-1]], color=S[0], height=0.55)
for i, k in enumerate(ks[::-1]): ax.text(g[k]["median"] / 1000 + 3, i, f'{g[k]["median"]:,}', va="center", fontsize=9, color=INK)
ax.set_xlabel("Median execution gas (×1,000)"); ax.grid(axis="y", visible=False); save(fig, "gas_ops.png")

# Cost per subscriber vs batch size (Base Sepolia measured gas price)
c = J("cost_model.json")["rows"]; b = [r for r in c if r["op"].startswith("chargeBatch")]
x = [int(r["op"][12:-1]) for r in b]
fig, ax = plt.subplots(figsize=(6.4, 2.9))
ax.plot(x, [r["baseSepolia"]["pctOf20UsdCyclePerSubscriber"] * 1000 for r in b], marker="o", color=S[1], label="Base Sepolia (measured gas price)")
ax.plot(x, [r["assumedMainnetL2Only"]["pctOf20UsdCyclePerSubscriber"] * 1000 for r in b], marker="s", color=S[0], label="Base mainnet L2 (assumed 0.01 gwei)")
ax.set_xscale("log"); ax.set_xticks(x, [str(v) for v in x]); ax.minorticks_off(); ax.set_ylim(0, None)
ax.set_xlabel("Batch size (subscriptions per chargeBatch)"); ax.set_ylabel("Charge cost (thousandths of % of 20 USD)"); ax.legend(frameon=False, fontsize=9)
save(fig, "cost_batch.png")

# Lifecycle on Sepolia: status timeline
L = J("lifecycle_testnet.json")["steps"]; t0 = L[0]["blockTimestamp"]
code = {"Active": 3, "PastDue": 2, "Cancelled": 1, "Lapsed": 0}
ts = [((s.get("blockTimestamp") or s["chainTime"]) - t0) / 60 for s in L]
fig, ax = plt.subplots(figsize=(6.6, 3.0))
ax.step(ts, [code[s["status"]] for s in L], where="post", color=S[0])
ax.scatter(ts, [code[s["status"]] for s in L], c=[S[2] if s["entitled"] else S[1] for s in L], zorder=3, s=36, edgecolors="white")
for i, (t, s) in enumerate(zip(ts, L), 1):
    ax.annotate(str(i), (t, code[s["status"]]), textcoords="offset points", xytext=(0, 8 if i % 2 else -15), ha="center", fontsize=8.5, color=INK)
ax.set_yticks([1, 2, 3], ["Cancelled", "PastDue", "Active"]); ax.set_ylim(0.5, 3.6)
ax.set_xlabel("Minutes since subscribe (Sepolia block time)"); ax.plot([], [], "o", color=S[2], label="entitled"); ax.plot([], [], "o", color=S[1], label="not entitled"); ax.legend(frameon=False, fontsize=8, loc="lower left")
save(fig, "lifecycle.png")

# Sequence diagram: one billing period
fig, ax = plt.subplots(figsize=(7.4, 5.8)); ax.axis("off")
actors = ["Subscriber", "SubscriptionVault", "Keeper", "Gateway", "AI Power Grid", "UsageRootRegistry"]
X = {a: i * 1.6 for i, a in enumerate(actors)}; top = 11.5
for a in actors:
    ax.text(X[a], top + 0.3, a.replace("Registry", "\nRegistry").replace("Vault", "\nVault").replace(" Grid", "\nGrid"), ha="center", fontsize=8.5, bbox=dict(boxstyle="round", fc="#fdf7ef", ec="#444"))
    ax.plot([X[a], X[a]], [0.2, top], color="#999", lw=0.8, ls="--")
msgs = [("Subscriber", "SubscriptionVault", "subscribeWithPermit (one signature)"), ("SubscriptionVault", "SubscriptionVault", "pull price; nextChargeAt = now + period"),
        ("Subscriber", "Gateway", "SIWE sign-in, then /v1/chat/completions"), ("Gateway", "SubscriptionVault", "entitledSubOf (cached 15 s)"),
        ("Gateway", "AI Power Grid", "forward request (platform key)"), ("AI Power Grid", "Gateway", "SSE stream + usage"),
        ("Gateway", "Subscriber", "stream relayed; usage row stored"), ("Keeper", "SubscriptionVault", "chargeBatch(ids) when due"),
        ("SubscriptionVault", "SubscriptionVault", "pull exactly price; nextChargeAt += period"), ("Gateway", "UsageRootRegistry", "commitRoot(epoch root)")]
y = top - 0.8
for a, b2, m in msgs:
    if a == b2:
        ax.annotate("", xy=(X[a] + 0.05, y - 0.35), xytext=(X[a] + 0.05, y), arrowprops=dict(arrowstyle="->", connectionstyle="arc3,rad=-1.2", color=INK, lw=0.9))
        ax.text(X[a] + 0.35, y - 0.15, m, fontsize=7.5, va="center", bbox=dict(fc="white", ec="none", pad=0.6))
    else:
        ax.annotate("", xy=(X[b2], y), xytext=(X[a], y), arrowprops=dict(arrowstyle="->", color=INK, lw=0.9))
        ax.text((X[a] + X[b2]) / 2, y + 0.14, m, ha="center", fontsize=7.5, bbox=dict(fc="white", ec="none", pad=0.6))
    y -= 1.05
ax.set_xlim(-0.8, X[actors[-1]] + 0.8); ax.set_ylim(0, top + 0.8); save(fig, "sequence.png")
