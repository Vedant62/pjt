#!/usr/bin/env node
// `pnpm testnet:up` — keeper + gateway against Base Sepolia (each reads its own .env; AIPG_MODE comes from gateway/.env)
// + dashboard defaulting to chain 84532. Ctrl-C stops everything.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const addresses = JSON.parse(readFileSync(join(root, "packages/shared/src/addresses.json"), "utf8"));
if (!addresses["84532"]) (console.error("No Base Sepolia deployment in packages/shared — run `pnpm deploy:testnet` first."), process.exit(1));
for (const p of ["keeper/.env", "gateway/.env"]) if (!existsSync(join(root, p))) (console.error(`${p} missing — copy ${p}.example and set CHAIN_ID=84532, RPC_URL, keys.`), process.exit(1));

const env84532 = { CHAIN_ID: "84532", DATA_DIR: join(root, "gateway/data/84532"), EPOCH_DIR: join(root, "gateway/epochs/84532") };
const procs = [];
const colors = { keeper: 33, gateway: 36, dashboard: 35 };
function run(name, cwd, cmd, args, env = {}) {
  const p = spawn(cmd, args, { cwd: join(root, cwd), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `\x1b[${colors[name]}m[${name}]\x1b[0m `;
  for (const s of [p.stdout, p.stderr]) s.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => process.stdout.write(tag + l + "\n")));
  p.on("exit", (c) => console.log(`${tag}exited ${c}`));
  procs.push(p);
}
// CHAIN_ID is forced; other settings (RPC_URL, keys, AIPG_MODE…) come from each package's .env.
run("keeper", "keeper", join(root, "keeper/node_modules/.bin/tsx"), ["src/index.ts"], { CHAIN_ID: "84532" });
run("gateway", "gateway", join(root, "gateway/node_modules/.bin/tsx"), ["src/index.ts"], env84532);
run("dashboard", "dashboard", "pnpm", ["exec", "next", "dev", "-p", process.env.DASHBOARD_PORT ?? "3000"], { NEXT_PUBLIC_DEFAULT_CHAIN: "84532", NEXT_PUBLIC_ENABLE_DEV_WALLETS: "false" });
const stop = () => (procs.forEach((p) => p.kill("SIGTERM")), setTimeout(() => process.exit(0), 1500));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
