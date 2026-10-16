/** results/grid_snapshot.json — AIPG GET /v1/workers and GET /v1/status/models at run time. Uses no inference credits. */
import "dotenv/config";
import { meta, writeResult } from "./lib/common";

const BASE = (process.env.AIPG_BASE_URL ?? "https://api.aipowergrid.io").replace(/\/$/, "");
const KEY = process.env.AIPG_API_KEY ?? "";
const OUR_WORKERS = (process.env.AIPG_OUR_WORKERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function get(path: string) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${BASE}${path}`, { headers: KEY ? { authorization: `Bearer ${KEY}`, apikey: KEY } : {}, signal: AbortSignal.timeout(15_000) });
    const text = await r.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: r.status, ms: Math.round(performance.now() - t0), body };
  } catch (e) {
    return { status: null, ms: null, body: null, error: (e as Error).message };
  }
}

const workers = await get("/v1/workers");
const models = await get("/v1/status/models");
const wb = workers.body as any;
const list: any[] | null = Array.isArray(wb) ? wb : Array.isArray(wb?.workers) ? wb.workers : Array.isArray(wb?.data) ? wb.data : null;
const textModels = list ? [...new Set(list.filter((w) => (w.job_types ?? []).includes("text")).flatMap((w) => w.models ?? []))] : null;
const qwen3Online = list ? list.some((w) => w.online !== false && (w.models ?? []).some((m: string) => /^qwen3:/i.test(m))) : null;
const ours = list && OUR_WORKERS.length ? list.filter((w) => OUR_WORKERS.some((o) => [w.name, w.id].includes(o))) : null;

writeResult("grid_snapshot.json", {
  ...meta("sim/src/grid-snapshot.ts", { baseUrl: BASE }),
  summary: {
    workersOnline: list ? list.filter((w) => w.online !== false).length : null,
    textModelsOnline: textModels,
    qwen3WorkerOnline: qwen3Online,
    workersOnlineNote: list ? "count of entries returned by /v1/workers" : "could not parse /v1/workers (see raw)",
    ourWorkers: OUR_WORKERS.length ? ours : null,
    ourWorkersNote: OUR_WORKERS.length ? "matched by name/id from AIPG_OUR_WORKERS" : "set AIPG_OUR_WORKERS=<name,…> to identify our worker(s)",
  },
  workers,
  models,
});
