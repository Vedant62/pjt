"""Render results/*.png from results/*.json (matplotlib, 300 dpi, white background, no in-image titles).
Run: sim/.venv/bin/python sim/plots.py   (or `pnpm results:summary`)."""
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "..", "results")
# Categorical slots in fixed order (validated: scripts/validate_palette.js, light mode).
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
INK, MUTED, GRID = "#1f1f1e", "#6b6a63", "#e6e5df"

plt.rcParams.update({
    "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
    "font.size": 9, "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "axes.spines.top": False, "axes.spines.right": False,
    "lines.linewidth": 2, "legend.frameon": False,
})


def load(name):
    p = os.path.join(RESULTS, name)
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return json.load(f)


def save(fig, name):
    p = os.path.join(RESULTS, name)
    fig.savefig(p, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print("wrote", p)


def fmt_secs(s):
    return f"{s // 3600} h" if s >= 3600 else f"{s // 60} min" if s >= 60 else f"{s} s"


def batch_sweep():
    d = load("batch_sweep.json")
    if not d:
        return print("skip fig_batch_sweep (no batch_sweep.json)")
    rows = d["sweep"]
    x = [r["batchSize"] for r in rows]
    fig, (a, b) = plt.subplots(1, 2, figsize=(7.2, 2.8))
    a.plot(x, [r["gasPerSubscriber"] / 1000 for r in rows], color=SERIES[0], marker="o", markersize=5)
    a.axhline(d["singleCharge"]["gasUsed"] / 1000, color=MUTED, linewidth=1, linestyle="--")
    a.annotate("single charge() tx", (x[-1], d["singleCharge"]["gasUsed"] / 1000), textcoords="offset points",
               xytext=(0, 4), ha="right", fontsize=8, color=MUTED)
    a.set_xscale("log")
    a.set_xticks(x, [str(v) for v in x])
    a.minorticks_off()
    a.set_xlabel("Batch size (subscriptions per chargeBatch tx)")
    a.set_ylabel("Gas per subscriber (×1,000 gas)")
    a.set_ylim(0, None)
    b.plot(x, [r["totalGas"] / 1e6 for r in rows], color=SERIES[0], marker="o", markersize=5)
    b.set_xscale("log")
    b.set_xticks(x, [str(v) for v in x])
    b.minorticks_off()
    b.set_xlabel("Batch size (subscriptions per chargeBatch tx)")
    b.set_ylabel("Total gas per tx (million gas)")
    b.set_ylim(0, None)
    fig.tight_layout()
    save(fig, "fig_batch_sweep.png")


def drift_cdf():
    d = load("schedule_sim.json")
    if not d:
        return print("skip fig_drift_cdf (no schedule_sim.json)")
    fig, ax = plt.subplots(figsize=(6.4, 3.2))
    for i, r in enumerate(sorted(d["results"], key=lambda r: r["tickSeconds"])):
        s = sorted(r["driftSamples"])
        if not s:
            continue
        n = len(s)
        ys = [(k + 1) / n for k in range(n)]
        xs = [max(v, 1) for v in s]
        ax.step(xs, ys, where="post", color=SERIES[i % len(SERIES)], label=f"tick {fmt_secs(r['tickSeconds'])}")
        ax.annotate(fmt_secs(r["tickSeconds"]), (xs[-1], 1.0), textcoords="offset points", xytext=(2, -10),
                    fontsize=8, color=INK)
    ax.set_xscale("log")
    ax.set_xlabel("Charge drift: execution time − scheduled time (s, log scale)")
    ax.set_ylabel("Fraction of charges")
    ax.set_ylim(0, 1.02)
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    save(fig, "fig_drift_cdf.png")


def ttft():
    d = load("gateway_bench.json")
    if not d or not d.get("samples"):
        return print("skip fig_ttft (no gateway_bench.json samples)")
    groups = [("direct", "Direct to AIPG"), ("gateway", "Through Cashew Gateway")]
    data = [[s["ttftMs"] for s in d["samples"] if s["path"] == g and s.get("ttftMs") is not None] for g, _ in groups]
    if not all(data):
        return print("skip fig_ttft (missing a group)")
    fig, ax = plt.subplots(figsize=(5.2, 3.0))
    bp = ax.boxplot(data, vert=False, widths=0.45, patch_artist=True, showfliers=True,
                    medianprops={"color": INK, "linewidth": 1.5})
    for patch, c in zip(bp["boxes"], SERIES):
        patch.set_facecolor(c)
        patch.set_alpha(0.35)
        patch.set_edgecolor(c)
    for i, (vals, c) in enumerate(zip(data, SERIES)):
        ax.scatter(vals, [i + 1] * len(vals), s=14, color=c, zorder=3, edgecolors="white", linewidths=0.6)
    ax.set_yticks([1, 2], [label for _, label in groups])
    ax.set_xlabel("Time to first token (ms)")
    ax.grid(axis="y", visible=False)
    fig.tight_layout()
    save(fig, "fig_ttft.png")


if __name__ == "__main__":
    which = sys.argv[1:] or ["batch", "drift", "ttft"]
    if "batch" in which:
        batch_sweep()
    if "drift" in which:
        drift_cdf()
    if "ttft" in which:
        ttft()
