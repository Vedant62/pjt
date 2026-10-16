import express, { type Response } from "express";
import cors from "cors";
import type { Hex } from "viem";
import type { GatewayConfig } from "./config";
import { openDb } from "./db";
import { makeChain, EntitlementCache } from "./chain";
import { makeAuth, type AuthedRequest } from "./auth";
import { makeUpstream, SseAccumulator, estimateTokens } from "./aipg";
import { EpochJob } from "./epochs";
import { canonicalJson, keccakText, RateLimiter } from "./util";

const EXPOSED = [
  "X-Grid-Job-ID",
  "X-Cashew-Sub-Id",
  "X-Cashew-Entitlement-Ms",
  "X-Cashew-Entitlement-Cache",
  "X-Cashew-Row-Id",
  "X-Cashew-Live-Remaining",
];

export function createGateway(cfg: GatewayConfig, opts: { dbFile?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? ((m: string) => console.log(`[gateway ${new Date().toISOString()}] ${m}`));
  const db = openDb(cfg.dataDir, opts.dbFile);
  const ctx = makeChain(cfg);
  const entitlements = new EntitlementCache(ctx, cfg.planId, cfg.entitlementCacheMs);
  const auth = makeAuth(cfg, db, ctx);
  const upstream = makeUpstream(cfg);
  const epochs = new EpochJob(cfg, db, ctx, log);
  const limiter = new RateLimiter(cfg.rateLimitPerMin);
  const liveRemaining = () => Math.max(0, cfg.maxLiveRequests - db.counter("live_requests"));

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ exposedHeaders: EXPOSED }));
  app.use(express.json({ limit: "1mb" }));

  // ------------------------------------------------------------------ auth

  app.get("/auth/nonce", (_req, res) => {
    res.json({ nonce: auth.issueNonce(), domain: cfg.siweDomain, chainId: cfg.chainId });
  });

  app.post("/auth/verify", async (req, res) => {
    try {
      const { message, signature } = req.body as { message: string; signature: Hex };
      if (typeof message !== "string" || typeof signature !== "string") throw new Error("message and signature required");
      res.json(await auth.verify(message, signature));
    } catch (e) {
      res.status(401).json({ error: { type: "unauthorized", message: (e as Error).message } });
    }
  });

  app.post("/keys", auth.requireJwt, (req: AuthedRequest, res) => {
    const key = auth.issueApiKey(req.wallet!);
    res.status(201).json({ key, wallet: req.wallet, note: "Store this key now; only its hash is kept." });
  });

  // ------------------------------------------------------------------ OpenAI-compatible API

  app.get("/v1/models", async (_req, res) => {
    const upstreamModels = (await upstream.models()) as { id?: string }[] | null;
    const byId = new Map((upstreamModels ?? []).map((m) => [m.id, m]));
    res.json({
      object: "list",
      data: cfg.allowedModels.map((id) => ({
        id,
        object: "model",
        owned_by: "aipowergrid",
        available: upstreamModels ? byId.has(id) : null,
        upstream: byId.get(id) ?? null,
      })),
    });
  });

  app.post("/v1/chat/completions", auth.requireWallet, async (req: AuthedRequest, res) => {
    const t0 = performance.now();
    const wallet = req.wallet!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 1–3. Entitlement
    let ent;
    try {
      ent = await entitlements.check(wallet);
    } catch (e) {
      return res.status(502).json({ error: { type: "chain_unavailable", message: (e as Error).message.split("\n")[0] } });
    }
    res.setHeader("X-Cashew-Entitlement-Ms", ent.ms.toFixed(2));
    res.setHeader("X-Cashew-Entitlement-Cache", ent.cached ? "hit" : "miss");
    if (!ent.ent.entitled) {
      return res.status(402).json({
        error: {
          type: "payment_required",
          status: ent.ent.status,
          subId: ent.ent.subId.toString(),
          nextChargeAt: ent.ent.nextChargeAt,
          planId: cfg.planId.toString(),
          message:
            ent.ent.status === "None"
              ? `No subscription to plan ${cfg.planId} for ${wallet}. Subscribe on-chain to use the API.`
              : `Subscription ${ent.ent.subId} is ${ent.ent.status} and not entitled. Top up / re-subscribe to restore access.`,
        },
      });
    }
    res.setHeader("X-Cashew-Sub-Id", ent.ent.subId.toString());

    // 4. Policy: model allowlist, max_tokens cap, rate limit, live budget
    const model = String(body.model ?? "");
    if (!cfg.allowedModels.includes(model)) {
      return res.status(400).json({
        error: { type: "model_not_allowed", message: `model must be one of ${cfg.allowedModels.join(", ")}` },
      });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return res.status(400).json({ error: { type: "invalid_request", message: "messages[] required" } });
    }
    const requested = Number(body.max_tokens ?? body.max_completion_tokens ?? cfg.maxTokensCap);
    const maxTokens = Math.max(1, Math.min(Number.isFinite(requested) ? requested : cfg.maxTokensCap, cfg.maxTokensCap));
    const stream = body.stream === true;

    if (cfg.aipgMode === "live") {
      const rl = limiter.allow(wallet.toLowerCase());
      if (!rl.ok) {
        res.setHeader("Retry-After", String(rl.retryAfterSec));
        return res.status(429).json({ error: { type: "rate_limited", message: `max ${cfg.rateLimitPerMin} requests/min per wallet` } });
      }
      // Reserve one unit of the global live budget before calling upstream (persisted, survives restarts).
      const used = db.bumpCounter("live_requests");
      if (used > cfg.maxLiveRequests) {
        return res.status(503).json({
          error: { type: "live_budget_exhausted", message: `AIPG live budget of ${cfg.maxLiveRequests} requests is used up` },
        });
      }
      res.setHeader("X-Cashew-Live-Remaining", String(liveRemaining()));
    }

    // 5. Forward
    const fwd: Record<string, unknown> = { ...body, model, max_tokens: maxTokens, stream };
    delete fwd.max_completion_tokens;
    if (stream) fwd.stream_options = { include_usage: true };
    const requestHash = keccakText(canonicalJson(fwd));

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    let up: Response | globalThis.Response;
    try {
      up = await upstream.chatCompletions(fwd, abort.signal);
    } catch (e) {
      return res.status(502).json({ error: { type: "upstream_unavailable", message: (e as Error).message } });
    }
    // 6. Grid job id
    const gridJobId = up.headers.get("x-grid-job-id");
    if (gridJobId) res.setHeader("X-Grid-Job-ID", gridJobId);

    if (!up.ok || !up.body) {
      const text = await up.text().catch(() => "");
      res.status(up.status || 502).type(up.headers.get("content-type") ?? "application/json").send(text);
      log(`upstream ${up.status} for ${wallet}: ${text.slice(0, 200)}`);
      return;
    }

    let ttftMs: number | null = null;
    let content = "";
    let usage: { prompt_tokens: number; completion_tokens: number } | null = null;

    if (stream) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      const acc = new SseAccumulator();
      const dec = new TextDecoder();
      try {
        for await (const chunk of up.body as unknown as AsyncIterable<Uint8Array>) {
          if (ttftMs === null) ttftMs = performance.now() - t0;
          res.write(chunk); // pass SSE bytes through unchanged
          acc.push(dec.decode(chunk, { stream: true }));
        }
      } catch {
        /* client went away or upstream aborted; record what we have */
      }
      res.end();
      // Hash what the model produced: reasoning (qwen3 thinking) followed by the visible content.
      content = acc.reasoning + acc.content;
      usage = acc.usage;
    } else {
      const text = await up.text();
      ttftMs = performance.now() - t0;
      res.status(200).type("application/json");
      try {
        const j = JSON.parse(text);
        const m = j.choices?.[0]?.message ?? {};
        content = (m.reasoning_content ?? m.reasoning ?? "") + (m.content ?? "");
        usage = j.usage ?? null;
      } catch {
        content = text;
      }
      // Row id header must be set before the body is sent, so record first.
      const rowId = record();
      res.setHeader("X-Cashew-Row-Id", String(rowId));
      res.send(text);
      return;
    }
    record();

    // 7. Usage row
    function record() {
      const ts = Math.floor(Date.now() / 1000);
      const estimated = !usage;
      const promptTokens = usage?.prompt_tokens ?? estimateTokens(JSON.stringify(fwd.messages));
      const completionTokens = usage?.completion_tokens ?? estimateTokens(content);
      const id = db.insertUsage({
        epoch: epochs.epochOf(ts),
        wallet: wallet.toLowerCase(),
        subId: ent!.ent.subId.toString(),
        model,
        promptTokens,
        completionTokens,
        requestHash,
        responseHash: keccakText(content),
        timestamp: ts,
        gridJobId,
        ttftMs: ttftMs === null ? null : Math.round(ttftMs),
        totalMs: Math.round(performance.now() - t0),
        stream: stream ? 1 : 0,
        usageSource: estimated ? "estimated" : "upstream",
      });
      log(`row ${id}: ${wallet} sub ${ent!.ent.subId} ${model} ${promptTokens}+${completionTokens} tok${estimated ? " (est.)" : ""}`);
      return id;
    }
  });

  // ------------------------------------------------------------------ usage + epochs

  app.get("/usage/me", auth.requireWallet, (req: AuthedRequest, res) => {
    res.json({ rows: db.usageByWallet(req.wallet!.toLowerCase(), 50) });
  });

  app.get("/epochs", (_req, res) => {
    res.json({
      planId: cfg.planId.toString(),
      epochSeconds: cfg.epochSeconds,
      currentEpoch: epochs.currentEpoch(),
      epochs: db.listEpochs(String(cfg.planId)).map(({ file: _f, ...e }) => e),
    });
  });

  app.get("/epochs/:epoch/rows", (req, res) => {
    const epoch = Number(req.params.epoch);
    const committed = db.getEpoch(String(cfg.planId), epoch);
    res.json({
      epoch,
      committed: !!committed,
      rows: db.usageByEpoch(epoch).map((r) => ({
        id: r.id,
        wallet: r.wallet,
        subId: r.subId,
        model: r.model,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        timestamp: r.timestamp,
        gridJobId: r.gridJobId,
      })),
    });
  });

  app.get("/epochs/:epoch/tree", (req, res) => {
    const f = epochs.loadFile(Number(req.params.epoch));
    if (!f) return res.status(404).json({ error: { type: "not_found", message: "epoch not committed" } });
    res.json(f);
  });

  app.get("/epochs/:epoch/proof/:rowId", (req, res) => {
    const p = epochs.proof(Number(req.params.epoch), Number(req.params.rowId));
    if (!p) return res.status(404).json({ error: { type: "not_found", message: "row not in a committed epoch" } });
    res.json(p);
  });

  // ------------------------------------------------------------------ health

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      mode: cfg.aipgMode,
      chainId: cfg.chainId,
      planId: cfg.planId.toString(),
      liveBudget: { max: cfg.maxLiveRequests, used: db.counter("live_requests"), remaining: liveRemaining() },
      lastCommittedEpoch: epochs.lastCommitted,
      currentEpoch: epochs.currentEpoch(),
      epochSeconds: cfg.epochSeconds,
      epochError: epochs.lastError,
      entitlementCacheSize: entitlements.size,
      allowedModels: cfg.allowedModels,
      maxTokensCap: cfg.maxTokensCap,
    });
  });

  return {
    app,
    db,
    ctx,
    entitlements,
    epochs,
    close: () => {
      epochs.stop();
      db.raw.close();
    },
  };
}
