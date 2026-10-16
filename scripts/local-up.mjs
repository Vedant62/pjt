#!/usr/bin/env node
// `pnpm local:up` — fresh anvil → deploy + seed → sync ABIs → keeper + gateway (mock) + dashboard.
// Ctrl-C stops everything. Pass --no-dashboard to skip the Next.js app.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "http://127.0.0.1:8545";
const args = new Set(process.argv.slice(2));
const children = [];
const colors = { anvil: 90, keeper: 33, gateway: 36, dashboard: 35 };

function run(name, cmd, argv, opts = {}) {
  const p = spawn(cmd, argv, { cwd: opts.cwd ?? root, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `\x1b[${colors[name] ?? 37}m[${name}]\x1b[0m `;
  const pipe = (s, out) => s.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => out.write(tag + l + "\n")));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on("exit", (code) => {
    if (!stopping) {
      console.error(`${tag}exited with ${code}; stopping everything`);
      stop(1);
    }
  });
  children.push(p);
  return p;
}

function step(label, cmd, argv, cwd = root, env = {}) {
  console.log(`\x1b[1m▸ ${label}\x1b[0m`);
  const r = spawnSync(cmd, argv, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`✗ ${label} failed`);
    stop(1);
  }
}

async function waitForRpc() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("anvil did not start");
}

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

try {
  await fetch(RPC, { method: "POST" });
  console.error("Something is already listening on :8545. Stop it first (local:up starts a fresh anvil).");
  process.exit(1);
} catch {}

// 1-second blocks so `block.timestamp` keeps moving and keepers see subscriptions become due.
run("anvil", "anvil", ["--block-time", "1", "--silent"]);
await waitForRpc();

const forgeEnv = { PRIVATE_KEY: "", GATEWAY_ADDRESS: "", SUBSCRIBER_ADDRESSES: "" }; // force anvil defaults
for (const k of Object.keys(forgeEnv)) delete process.env[k];
step("deploy", "forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast", "-q"], join(root, "contracts"));
step("seed", "forge", ["script", "script/Seed.s.sol", "--rpc-url", RPC, "--broadcast", "-q"], join(root, "contracts"));
step("sync ABIs", "node", ["packages/shared/scripts/sync.mjs"]);

// Fresh chain → fresh gateway DB / epoch files / keeper log.
const gwData = join(root, "gateway", "data", "31337");
const gwEpochs = join(root, "gateway", "epochs", "31337");
rmSync(gwData, { recursive: true, force: true });
rmSync(gwEpochs, { recursive: true, force: true });
const klog = join(root, "keeper", "logs", "keeper-31337.jsonl");
if (existsSync(klog)) renameSync(klog, klog.replace(".jsonl", `.${Date.now()}.jsonl`));
mkdirSync(gwData, { recursive: true });

const local = { RPC_URL: RPC, CHAIN_ID: "31337" };
run("keeper", "pnpm", ["exec", "tsx", "src/index.ts"], {
  cwd: join(root, "keeper"),
  env: { ...local, KEEPER_PRIVATE_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", TICK_SECONDS: process.env.TICK_SECONDS ?? "15" },
});
run("gateway", "pnpm", ["exec", "tsx", "src/index.ts"], {
  cwd: join(root, "gateway"),
  env: {
    ...local,
    AIPG_MODE: "mock",
    PLAN_ID: "1",
    GATEWAY_PRIVATE_KEY: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    DATA_DIR: gwData,
    EPOCH_DIR: gwEpochs,
    EPOCH_SECONDS: process.env.EPOCH_SECONDS ?? "300",
  },
});
if (!args.has("--no-dashboard") && existsSync(join(root, "dashboard", "package.json"))) {
  run("dashboard", "pnpm", ["exec", "next", "dev", "-p", "3000"], { cwd: join(root, "dashboard"), env: { NEXT_PUBLIC_DEFAULT_CHAIN: "31337" } });
}
console.log("\n\x1b[1mCashew local stack\x1b[0m  anvil :8545 · gateway :8787 · keeper health :8788 · dashboard :3000\n");
