import { resolve } from "node:path";
import type { Hex } from "viem";

export interface GatewayConfig {
  port: number;
  rpcUrl: string;
  chainId: number;
  planId: bigint;
  gatewayKey: Hex;
  jwtSecret: string;
  siweDomain: string;
  aipgMode: "mock" | "live";
  aipgBaseUrl: string;
  aipgApiKey: string;
  maxLiveRequests: number;
  allowedModels: string[];
  maxTokensCap: number;
  rateLimitPerMin: number;
  mockTtftMs: number;
  mockTokenMs: number;
  epochSeconds: number;
  entitlementCacheMs: number;
  dataDir: string;
  epochDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  const mode = (env.AIPG_MODE ?? "mock").toLowerCase();
  if (mode !== "mock" && mode !== "live") throw new Error(`AIPG_MODE must be mock|live, got ${mode}`);
  const cfg: GatewayConfig = {
    port: Number(env.PORT ?? 8787),
    rpcUrl: env.RPC_URL ?? "http://127.0.0.1:8545",
    chainId: Number(env.CHAIN_ID ?? 31337),
    planId: BigInt(env.PLAN_ID ?? 1),
    gatewayKey: (env.GATEWAY_PRIVATE_KEY ??
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a") as Hex,
    jwtSecret: env.JWT_SECRET ?? "dev-only-insecure-secret",
    siweDomain: env.SIWE_DOMAIN ?? "localhost:3000,127.0.0.1:3000",
    aipgMode: mode,
    aipgBaseUrl: (env.AIPG_BASE_URL ?? "https://api.aipowergrid.io").replace(/\/$/, ""),
    aipgApiKey: env.AIPG_API_KEY ?? "",
    maxLiveRequests: Number(env.AIPG_MAX_LIVE_REQUESTS ?? 150),
    allowedModels: (env.ALLOWED_MODELS ?? "qwen3:8b,qwen3:4b,qwen3:1.7b").split(",").map((s) => s.trim()).filter(Boolean),
    maxTokensCap: Number(env.MAX_TOKENS_CAP ?? 256),
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN ?? 10),
    mockTtftMs: Number(env.MOCK_TTFT_MS ?? 350),
    mockTokenMs: Number(env.MOCK_TOKEN_MS ?? 20),
    epochSeconds: Number(env.EPOCH_SECONDS ?? 300),
    entitlementCacheMs: Number(env.ENTITLEMENT_CACHE_MS ?? 15000),
    dataDir: resolve(env.DATA_DIR ?? "./data"),
    epochDir: resolve(env.EPOCH_DIR ?? "./epochs"),
    ...overrides,
  };
  if (cfg.aipgMode === "live") {
    if (!cfg.aipgApiKey) throw new Error("AIPG_MODE=live requires AIPG_API_KEY");
    // Live mode protects the credit balance: max_tokens is never above 256.
    cfg.maxTokensCap = Math.min(cfg.maxTokensCap, 256);
  }
  if (cfg.jwtSecret === "dev-only-insecure-secret" && cfg.chainId !== 31337)
    throw new Error("Set JWT_SECRET for non-local chains");
  return cfg;
}
