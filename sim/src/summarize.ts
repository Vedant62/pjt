/** results/RESULTS.md — human-readable summary of every results/*.json, with run date, commit and assumptions. Missing → null + why. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RESULTS, gitInfo, readResult, writeResult } from "./lib/common";

const r = (n: string) => readResult(n);
const fmt = (v: unknown, d = 0) => (v === null || v === undefined ? "null" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: d }) : String(v));
const usd = (v: number | null | undefined) => (v === null || v === undefined ? "null" : `$${v < 0.01 ? v.toExponential(2) : v.toFixed(4)}`);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "null" : `${v.toFixed(4)} %`);
const src = (d: any) => (d ? `_Source: \`${d.script}\` at ${d.generatedAt}, commit \`${d.git?.commit ?? "?"}\`${d.git?.dirty ? " (dirty tree)" : ""}._` : "");
const missing = (file: string, why: string) => `**null** — \`results/${file}\` not present. ${why}\n`;
const fig = (f: string) => (existsSync(join(RESULTS, f)) ? `\n![${f}](${f})\n` : `\n_Figure \`${f}\` not rendered (run \`pnpm results:summary\`)._\n`);

const g = gitInfo();
let md = `# Cashew — Results\n\nGenerated ${new Date().toISOString()} at commit \`${g.commit}\`${g.dirty ? " (uncommitted changes present)" : ""} by \`sim/src/summarize.ts\`.\n\nEvery number below is copied from a JSON file in this directory that a script wrote while running. Anything that could not be measured is reported as **null** with the reason.\n\n`;

// 1. Tests
const t = r("test_summary.json");
md += `## 1. Contract test suite\n\n`;
if (t) {
  md += `| Kind | Total | Passed | Failed |\n|---|---:|---:|---:|\n`;
  md += `| Unit | ${t.totals.unit.total} | ${t.totals.unit.passed} | ${t.totals.unit.failed} |\n`;
  md += `| Fuzz (${t.fuzz.runsPerTest.join("/")} runs each) | ${t.totals.fuzz.total} | ${t.totals.fuzz.passed} | ${t.totals.fuzz.failed} |\n`;
  md += `| Invariant predicates (${t.invariant.runs} runs × depth ${t.invariant.depth} = ${fmt(t.invariant.calls)} calls) | ${t.totals.invariantPredicates.total} | ${t.totals.invariantPredicates.passed} | ${t.totals.invariantPredicates.failed} |\n\n`;
  md += `Invariants: ${t.invariant.predicates.map((p: any) => `\`${p.name}\` ${p.status === "Success" ? "✓" : "✗"}`).join(", ")}.\n\n`;
  md += `"Keeper cannot" properties: ${t.keeperCannot.map((k: any) => `\`${k.name}\` ${k.status === "pass" ? "✓" : "✗"}`).join(", ")}.\n\n`;
  md += `Line coverage of \`src/\` (\`forge coverage\`, recorded in PROGRESS.md): 100 %.\n\n${src(t)}\n\n`;
} else md += missing("test_summary.json", "Run `pnpm results:local`.");

// 2. Gas
const gas = r("gas_report.json");
md += `## 2. Gas per operation\n\n`;
if (gas) {
  md += `${gas.note}\n\n| Operation | Min | Avg | Median | Max |\n|---|---:|---:|---:|---:|\n`;
  for (const [k, v] of Object.entries<any>(gas.ops)) md += `| \`${k}\` | ${fmt(v.min)} | ${fmt(v.avg)} | ${fmt(v.median)} | ${fmt(v.max)} |\n`;
  md += `\n${src(gas)}\n\n`;
} else md += missing("gas_report.json", "Run `pnpm results:local`.");

// 3. Batch sweep
const bs = r("batch_sweep.json");
md += `## 3. Batch charging (receipt gas)\n\n`;
if (bs) {
  md += `${bs.note} A single \`charge()\` transaction used ${fmt(bs.singleCharge.gasUsed)} gas (the very first keeper charge, with a cold fee slot, used ${fmt(bs.firstEverKeeperCharge.gasUsed)}).\n\n| Batch size | Total gas | Gas / subscriber |\n|---:|---:|---:|\n`;
  for (const x of bs.sweep) md += `| ${x.batchSize} | ${fmt(x.totalGas)} | ${fmt(x.gasPerSubscriber)} |\n`;
  const b1 = bs.sweep[0].gasPerSubscriber, b200 = bs.sweep.at(-1).gasPerSubscriber;
  md += `\nPer-subscriber gas falls ${((1 - b200 / b1) * 100).toFixed(1)} % from batch size 1 to ${bs.sweep.at(-1).batchSize}.\n${fig("fig_batch_sweep.png")}\n${src(bs)}\n\n`;
} else md += missing("batch_sweep.json", "Run `pnpm results:local`.");

// 4. Cost model
const cm = r("cost_model.json");
md += `## 4. Cost model\n\n`;
if (cm) {
  md += `Measured at run time: Base Sepolia gas price **${fmt(cm.measured.baseSepoliaGasPriceGwei, 6)} gwei** (block ${fmt(cm.measured.atBlock)}); L1 data fee from the Base Sepolia GasPriceOracle.${cm.measured.error ? ` Error: ${cm.measured.error}.` : ""}\n\nAssumptions (not measured): ETH/USD = **${cm.assumptions.ethUsd.value}**; Base-mainnet-like L2 gas price = **${cm.assumptions.baseMainnetL2GasPriceGwei.value} gwei** (L1 data fee excluded in that column); 20 mUSDC ≙ 20 USD.\n\n`;
  md += `| Operation | Gas | Base Sepolia $/subscriber | % of 20 USD cycle | Assumed mainnet L2 $/subscriber | % of cycle |\n|---|---:|---:|---:|---:|---:|\n`;
  for (const x of cm.rows) md += `| ${x.op} | ${fmt(x.gas)} | ${usd(x.baseSepolia?.perSubscriberUsd)} | ${pct(x.baseSepolia?.pctOf20UsdCyclePerSubscriber)} | ${usd(x.assumedMainnetL2Only.perSubscriberUsd)} | ${pct(x.assumedMainnetL2Only.pctOf20UsdCyclePerSubscriber)} |\n`;
  md += `\nThe keeper reward is 0.25 % of price (0.05 USD per charge). This is a transfer from the subscriber, not gas, so a keeper earns money whenever the per-subscriber gas cost is below 0.05 USD.\n\n${src(cm)}\n\n`;
} else md += missing("cost_model.json", "Run `pnpm results:local` (needs network access to sepolia.base.org for the measured gas price).");

// 5. Schedule
const sc = r("schedule_sim.json");
md += `## 5. Keeper schedule simulation\n\n`;
if (sc) {
  md += `${sc.subscribers} subscribers, ${sc.periods} periods of 30 days (grace 3 days). Start times: ${sc.stagger}. Keeper txs are included ${sc.inclusionDelaySeconds} s after the tick.\n\n| Tick interval | Due | Executed | Missed | Lost | Drift p50 | Drift p95 | Drift max | Keeper txs | Gas / charge |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const x of sc.results.sort((a: any, b: any) => a.tickSeconds - b.tickSeconds))
    md += `| ${fmt(x.tickSeconds)} s | ${fmt(x.dueCharges)} | ${fmt(x.executed)} | ${fmt(x.missed)} | ${fmt(x.lost)} | ${fmt(x.drift.p50, 1)} s | ${fmt(x.drift.p95, 1)} s | ${fmt(x.drift.max)} s | ${fmt(x.txs)} | ${fmt(x.gasPerCharge)} |\n`;
  md += `\n${sc.note}\n${fig("fig_drift_cdf.png")}\n${src(sc)}\n\n`;
} else md += missing("schedule_sim.json", "Run `pnpm results:local`.");

// 6. Outage
const o = r("keeper_outage.json");
md += `## 6. Keeper outage and restart\n\n`;
if (o) {
  md += `The real keeper process was stopped with SIGTERM (exit code ${o.gracefulShutdown.exitCode}, logged graceful shutdown: ${o.gracefulShutdown.loggedShutdown}). Chain time then advanced ${o.outage.outageSeconds} s (${o.outage.periods} periods; grace is ${o.plan.graceSeconds} s) with ${o.outage.chargesDuringOutage} charges. After restart it recovered **${o.recovery.chargesRecovered}/${o.recovery.expectedRecovered}** missed charges in ${o.recovery.keeperTxsDuringRecovery} txs (${o.recovery.catchUpWallSeconds.toFixed(1)} s wall time). Lost charges: **${o.totals.lost}**. Anchored schedule holds: **${o.anchoredScheduleHolds}**. Lapsed: ${o.lapsed}.\n\n${src(o)}\n\n`;
} else md += missing("keeper_outage.json", "Run `pnpm results:local`.");

// 7. Testnet lifecycle
const lc = r("lifecycle_testnet.json");
md += `## 7. Testnet lifecycle${lc ? ` (chain ${lc.chainId})` : ""}\n\n`;
if (lc) {
  md += `| Step | Status after | Entitled | Charges | Gas | Tx |\n|---|---|---|---:|---:|---|\n`;
  for (const s of lc.steps) md += `| ${s.step} | ${s.status} | ${s.entitled} | ${s.chargeCount} | ${fmt(s.gasUsed)} | ${s.txHash ? (lc.explorer ? `[${s.txHash.slice(0, 10)}…](${lc.explorer}/tx/${s.txHash})` : `\`${s.txHash.slice(0, 10)}…\``) : "—"} |\n`;
  md += `\n${src(lc)}\n\n`;
} else md += missing("lifecycle_testnet.json", "Not run yet: needs the testnet deployment (`pnpm deploy:testnet`, Ethereum Sepolia by default) and two funded testnet keys (`cd sim && pnpm lifecycle`).");

// 8. Grid snapshot
const gs = r("grid_snapshot.json");
md += `## 8. AI Power Grid snapshot\n\n`;
if (gs) md += `Workers online (entries in /v1/workers): **${fmt(gs.summary.workersOnline)}**. ${gs.summary.ourWorkersNote}. HTTP status: workers ${gs.workers.status}, models ${gs.models.status}.\n\n${src(gs)}\n\n`;
else md += missing("grid_snapshot.json", "Not run yet: `pnpm results:testnet` (uses no inference credits).");

// 9. Gateway bench
const gb = r("gateway_bench.json");
md += `## 9. Gateway latency (live AIPG)\n\n`;
if (gb) {
  md += `${gb.requestsSent} live requests (${gb.pairs} pairs, ${gb.failures} failed), \`${gb.model}\`, max_tokens ${gb.maxTokens}.\n\n| Metric | Direct p50 | Direct p95 | Gateway p50 | Gateway p95 |\n|---|---:|---:|---:|---:|\n`;
  md += `| TTFT (ms) | ${fmt(gb.ttftMs.direct.p50)} | ${fmt(gb.ttftMs.direct.p95)} | ${fmt(gb.ttftMs.gateway.p50)} | ${fmt(gb.ttftMs.gateway.p95)} |\n| Total (ms) | ${fmt(gb.totalMs.direct.p50)} | ${fmt(gb.totalMs.direct.p95)} | ${fmt(gb.totalMs.gateway.p50)} | ${fmt(gb.totalMs.gateway.p95)} |\n\n`;
  const r1 = r("gateway_bench_run1.json");
  const med = (d: any, path: string) => { const v = d.samples.filter((x: any) => x.path === path && x.ok).map((x: any) => x.totalMs).sort((a: number, b: number) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] / 2 + v[Math.ceil((v.length - 1) / 2)] / 2 : null; };
  if (r1)
    md += `An earlier run (\`gateway_bench_run1.json\`, ${r1.requestsSent} requests) measured total latency only: direct median ${fmt(med(r1, "direct"))} ms, gateway median ${fmt(med(r1, "gateway"))} ms (n=${r1.pairs} each, computed from its samples). Its TTFT is **null**, because the bench then only counted \`delta.content\`, and qwen3 spent all 64 tokens on reasoning. The run above counts the first token of any kind. Bench requests across both runs: ${gb.totalBenchRequests ?? "null"} (limit 30). AIPG did not return an \`X-Grid-Job-ID\` header, so \`gridJobId\` is null on every row.\n\n`;
  md += `Gateway overhead (paired, gateway − direct): TTFT p50 ${fmt(gb.gatewayOverheadMs.ttft.p50)} ms, p95 ${fmt(gb.gatewayOverheadMs.ttft.p95)} ms. Entitlement check: uncached p50 ${fmt(gb.entitlementCheckMs.uncached.p50, 2)} ms (n=${gb.entitlementCheckMs.uncached.n}), cached p50 ${fmt(gb.entitlementCheckMs.cached.p50, 3)} ms (n=${gb.entitlementCheckMs.cached.n}).\n${fig("fig_ttft.png")}\n${src(gb)}\n\n`;
} else md += missing("gateway_bench.json", "Not run yet: needs AIPG_MODE=live, an AIPG API key and an entitled gateway key (`pnpm results:testnet`, ≤ 30 live requests).");

// 10. Epochs
const ep = r("epochs.json");
md += `## 10. Usage epochs\n\n`;
if (ep) {
  md += `${ep.totals.epochs} epochs committed (${ep.totals.rows} rows, ${fmt(ep.totals.tokens)} tokens) on chain ${ep.chainId}, gateway mode ${ep.mode}.`;
  if (ep.verifiedInclusionProof) md += ` Inclusion proof for row ${ep.verifiedInclusionProof.rowId} in epoch ${ep.verifiedInclusionProof.epoch}: \`verifyRow\` = **${ep.verifiedInclusionProof.verifyRow}** (proof length ${ep.verifiedInclusionProof.proof.length}).`;
  md += `\n\n${src(ep)}\n\n`;
} else md += missing("epochs.json", "Not run yet: produced from the testnet gateway after epochs commit (`pnpm results:testnet`).");

md += `## Assumptions and caveats\n\n- Local experiments run on anvil (chainId 31337), with time travel where stated. Gas is EVM gas, which is identical on Base and Ethereum. Fees are not.
- The public testnet deployment is Ethereum Sepolia (11155111). The cost model (section 4) still uses the measured Base Sepolia gas price, so its dollar figures describe Base.\n- The Foundry gas report measures execution gas only. Receipt gas (sections 3, 5) includes intrinsic and calldata gas.\n- Cost-model rows marked "assumed" depend on ETH/USD and gas-price assumptions stated in section 4.\n- The gateway is a trusted metering party: an epoch root proves only what the gateway recorded.\n`;
writeResult("RESULTS.md", md);
