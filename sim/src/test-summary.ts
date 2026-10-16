/** results/test_summary.json — parsed from `forge test --json`. */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, meta, writeResult } from "./lib/common";

const raw = execSync("forge test --json", { cwd: join(ROOT, "contracts"), maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] }).toString();
const json = JSON.parse(raw.slice(raw.indexOf("{")));

type Row = { suite: string; name: string; kind: "unit" | "fuzz" | "invariant"; status: string; runs?: number; calls?: number; reverts?: number };
const rows: Row[] = [];
let invariantPredicates: { name: string; status: string }[] = [];
for (const [suite, s] of Object.entries<any>(json)) {
  for (const [name, t] of Object.entries<any>(s.test_results)) {
    const k = t.kind ?? {};
    if (k.Invariant) {
      rows.push({ suite, name, kind: "invariant", status: t.status, runs: k.Invariant.runs, calls: k.Invariant.calls, reverts: k.Invariant.reverts });
      invariantPredicates = invariantPredicates.concat(t.invariant_predicate_results ?? [{ name, status: t.status }]);
    } else if (k.Fuzz) rows.push({ suite, name, kind: "fuzz", status: t.status, runs: k.Fuzz.runs });
    else rows.push({ suite, name, kind: "unit", status: t.status });
  }
}

const count = (kind: Row["kind"]) => {
  const r = rows.filter((x) => x.kind === kind);
  return { total: r.length, passed: r.filter((x) => x.status === "Success").length, failed: r.filter((x) => x.status !== "Success").length };
};
const inv = rows.filter((r) => r.kind === "invariant");
const keeperCannot = rows
  .filter((r) => r.name.startsWith("test_KeeperCannot_"))
  .map((r) => ({ name: r.name.replace("()", ""), status: r.status === "Success" ? "pass" : "fail" }));

// invariant depth comes from the forge-config in the invariant test (runs × depth = calls)
const depth = inv[0] && inv[0].runs ? Math.round((inv[0].calls ?? 0) / inv[0].runs) : null;

writeResult("test_summary.json", {
  ...meta("sim/src/test-summary.ts", { command: "forge test --json" }),
  totals: {
    unit: count("unit"),
    fuzz: count("fuzz"),
    // Foundry runs the five invariant predicates as one campaign; both views are reported.
    invariantCampaigns: count("invariant"),
    invariantPredicates: {
      total: invariantPredicates.length,
      passed: invariantPredicates.filter((p) => p.status === "Success").length,
      failed: invariantPredicates.filter((p) => p.status !== "Success").length,
    },
    all: { total: rows.length, passed: rows.filter((r) => r.status === "Success").length },
  },
  fuzz: { runsPerTest: Array.from(new Set(rows.filter((r) => r.kind === "fuzz").map((r) => r.runs))), tests: rows.filter((r) => r.kind === "fuzz").map((r) => ({ name: r.name, runs: r.runs, status: r.status })) },
  invariant: { runs: inv[0]?.runs ?? null, depth, calls: inv[0]?.calls ?? null, reverts: inv[0]?.reverts ?? null, predicates: invariantPredicates },
  keeperCannot,
  tests: rows,
});
