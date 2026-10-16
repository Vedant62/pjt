/**
 * results/gateway_bench.json — LIVE: TTFT and total latency direct-to-AIPG vs through the Cashew Gateway, same prompt
 * and model (qwen3:8b, max_tokens 64), streaming. Hard cap: BENCH_PAIRS pairs (default 12 → 24 inference requests,
 * well under the 30-request budget in SPEC §7). Also measures entitlement-check latency, cached vs uncached, from the
 * gateway's X-Cashew-Entitlement-* headers. Asks for confirmation before spending credits (skip with --yes).
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { meta, quantile, writeResult } from "./lib/common";

const AIPG = (process.env.AIPG_BASE_URL ?? "https://api.aipowergrid.io").replace(/\/$/, "");
const AIPG_KEY = process.env.AIPG_API_KEY ?? "";
const GW = (process.env.GATEWAY_URL ?? "http://localhost:8787").replace(/\/$/, "");
const GW_KEY = process.env.GATEWAY_API_KEY ?? "";
const PAIRS = Math.min(Number(process.env.BENCH_PAIRS ?? 12), 15);
const PRIOR = Number(process.env.BENCH_PRIOR_REQUESTS ?? 0); // live requests already spent by earlier bench runs
const MODEL = "qwen3:8b";
const BODY = { model: MODEL, stream: true, max_tokens: 64, messages: [{ role: "user", content: "In one sentence, what is a decentralized inference network?" }] };

if (!AIPG_KEY || !GW_KEY) throw new Error("set AIPG_API_KEY and GATEWAY_API_KEY (a csk_ key for an entitled wallet)");
const health = await (await fetch(`${GW}/health`)).json();
if (health.mode !== "live") throw new Error(`gateway is in ${health.mode} mode; bench needs AIPG_MODE=live`);
console.log(`Will send ${PAIRS * 2} live inference requests (${PAIRS} direct + ${PAIRS} via gateway). Gateway live budget left: ${health.liveBudget.remaining}.`);
if (!process.argv.includes("--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question("Spend AIPG credits? type 'yes': ");
  rl.close();
  if (a.trim() !== "yes") process.exit(1);
}

async function stream(url: string, key: string) {
  const t0 = performance.now();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(BODY) });
  if (!r.ok || !r.body) return { ok: false, status: r.status, error: (await r.text()).slice(0, 300) };
  let ttft: number | null = null;
  let completionTokens: number | null = null;
  let ttftKind: string | null = null;
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body as any as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
      try {
        const j = JSON.parse(line.slice(5));
        // First generated token of any kind: qwen3 streams its thinking as reasoning(_content) before any content.
        const delta = j.choices?.[0]?.delta ?? {};
        if (ttft === null && (delta.content || delta.reasoning_content || delta.reasoning)) {
          ttft = performance.now() - t0;
          ttftKind = delta.content ? "content" : "reasoning";
        }
        if (j.usage) completionTokens = j.usage.completion_tokens;
      } catch {}
    }
  }
  return {
    ok: true,
    status: r.status,
    ttftMs: ttft,
    ttftKind,
    totalMs: performance.now() - t0,
    completionTokens,
    gridJobId: r.headers.get("x-grid-job-id"),
    entitlementMs: r.headers.get("x-cashew-entitlement-ms") ? Number(r.headers.get("x-cashew-entitlement-ms")) : null,
    entitlementCache: r.headers.get("x-cashew-entitlement-cache"),
  };
}

const samples: any[] = [];
for (let i = 0; i < PAIRS; i++) {
  // Alternate order to avoid systematic warm-up bias.
  const order = i % 2 === 0 ? ["direct", "gateway"] : ["gateway", "direct"];
  for (const path of order) {
    const res = path === "direct" ? await stream(`${AIPG}/v1/chat/completions`, AIPG_KEY) : await stream(`${GW}/v1/chat/completions`, GW_KEY);
    samples.push({ i, path, ...res });
    console.log(`${i} ${path}: ${res.ok ? `ttft ${Math.round((res as any).ttftMs)} ms, total ${Math.round((res as any).totalMs)} ms` : `HTTP ${res.status}`}`);
  }
}

const stats = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return { n: s.length, p50: quantile(s, 0.5), p95: quantile(s, 0.95), min: s[0] ?? null, max: s.at(-1) ?? null };
};
const ok = samples.filter((s) => s.ok && s.ttftMs != null);
const pairDiffs = (field: "ttftMs" | "totalMs") =>
  Array.from({ length: PAIRS }, (_, i) => {
    const d = ok.find((s) => s.i === i && s.path === "direct");
    const g = ok.find((s) => s.i === i && s.path === "gateway");
    return d && g ? g[field] - d[field] : NaN;
  });
const gwSamples = ok.filter((s) => s.path === "gateway");

writeResult("gateway_bench.json", {
  ...meta("sim/src/bench.ts", { model: MODEL, maxTokens: 64, pairs: PAIRS, requestsSent: samples.length, priorBenchRequests: PRIOR, totalBenchRequests: PRIOR + samples.length, aipg: AIPG, gateway: GW }),
  note: "Network-dominated: grid inference latency varies with worker load, so overhead is reported as paired differences (gateway − direct, same iteration). Failed requests are kept in samples with ok=false.",
  ttftMs: { direct: stats(ok.filter((s) => s.path === "direct").map((s) => s.ttftMs)), gateway: stats(gwSamples.map((s) => s.ttftMs)) },
  totalMs: { direct: stats(ok.filter((s) => s.path === "direct").map((s) => s.totalMs)), gateway: stats(gwSamples.map((s) => s.totalMs)) },
  gatewayOverheadMs: { ttft: stats(pairDiffs("ttftMs")), total: stats(pairDiffs("totalMs")) },
  entitlementCheckMs: {
    uncached: stats(gwSamples.filter((s) => s.entitlementCache === "miss").map((s) => s.entitlementMs)),
    cached: stats(gwSamples.filter((s) => s.entitlementCache === "hit").map((s) => s.entitlementMs)),
  },
  failures: samples.filter((s) => !s.ok).length,
  samples,
});
