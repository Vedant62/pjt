/**
 * results/gas_report.json + .md — from `forge test --gas-report --json` over the deterministic unit tests
 * (fuzz/invariant tests excluded: their random inputs and handler calls would skew min/mean/max).
 * Note: Foundry gas reports measure call execution gas; they exclude the 21,000 intrinsic gas and calldata cost
 * of a real transaction. Real receipt gas for charge/chargeBatch is in batch_sweep.json.
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, meta, writeResult } from "./lib/common";

const cmd = "forge test --gas-report --json --no-match-path 'test/invariant/*' --no-match-test 'testFuzz_'";
const raw = execSync(cmd, { cwd: join(ROOT, "contracts"), maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] }).toString();
const report = JSON.parse(raw.slice(raw.indexOf("[")));

const WANT: Record<string, string[]> = {
  "src/PlanRegistry.sol:PlanRegistry": ["createPlan"],
  "src/SubscriptionVault.sol:SubscriptionVault": ["subscribeWithPermit", "subscribe", "charge", "chargeBatch", "cancel", "withdraw"],
  "src/UsageRootRegistry.sol:UsageRootRegistry": ["commitRoot"],
};
const ops: Record<string, { contract: string; signature: string; calls: number; min: number; avg: number; median: number; max: number }> = {};
for (const c of report) {
  const fns = WANT[c.contract];
  if (!fns) continue;
  for (const [sig, g] of Object.entries<any>(c.functions)) {
    const name = sig.split("(")[0];
    if (fns.includes(name)) ops[name] = { contract: c.contract.split(":")[1], signature: sig, calls: g.calls, min: g.min, avg: g.mean, median: g.median, max: g.max };
  }
}
const order = ["createPlan", "subscribeWithPermit", "subscribe", "charge", "chargeBatch", "cancel", "withdraw", "commitRoot"];
const out = {
  ...meta("sim/src/gas-report.ts", { command: cmd }),
  note: "Execution gas per call as measured by Foundry across unit tests (includes reverting calls in tests). Excludes 21,000 intrinsic + calldata gas. chargeBatch varies with batch size; see batch_sweep.json.",
  ops: Object.fromEntries(order.filter((o) => ops[o]).map((o) => [o, ops[o]])),
  deployments: Object.fromEntries(report.filter((c: any) => c.contract.startsWith("src/")).map((c: any) => [c.contract.split(":")[1], c.deployment])),
};
writeResult("gas_report.json", out);

let md = `# Gas report\n\nGenerated ${out.generatedAt} at commit \`${out.git.commit}\` by \`${out.script}\`.\n\n${out.note}\n\n| Operation | Contract | Calls | Min | Avg | Median | Max |\n|---|---|---:|---:|---:|---:|---:|\n`;
for (const o of order) {
  const g = ops[o];
  if (g) md += `| \`${o}\` | ${g.contract} | ${g.calls} | ${g.min} | ${g.avg} | ${g.median} | ${g.max} |\n`;
}
writeResult("gas_report.md", md);
