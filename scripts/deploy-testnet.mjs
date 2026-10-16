#!/usr/bin/env node
// `pnpm deploy:testnet` — deploy + seed + verify on Base Sepolia, then sync ABIs/addresses.
// Reads contracts/.env: PRIVATE_KEY, BASE_SEPOLIA_RPC_URL, ETHERSCAN_API_KEY, GATEWAY_ADDRESS, SUBSCRIBER_ADDRESSES.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "contracts/.env");
if (!existsSync(envFile)) {
  console.error("contracts/.env missing — copy contracts/.env.example and fill it in.");
  process.exit(1);
}
const env = { ...process.env };
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\s]*)/);
  if (m) env[m[1]] = m[2];
}
for (const k of ["PRIVATE_KEY", "GATEWAY_ADDRESS"]) if (!env[k] || env[k].includes("...")) (console.error(`set ${k} in contracts/.env`), process.exit(1));
const rpc = env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const verify = env.ETHERSCAN_API_KEY ? ["--verify", "--etherscan-api-key", env.ETHERSCAN_API_KEY] : [];
if (!verify.length) console.warn("ETHERSCAN_API_KEY not set — deploying WITHOUT BaseScan verification");

const run = (label, args, cwd = join(root, "contracts")) => {
  console.log(`\n▸ ${label}`);
  const r = spawnSync(args[0], args.slice(1), { cwd, env, stdio: "inherit" });
  if (r.status !== 0) (console.error(`✗ ${label}`), process.exit(1));
};
run("deploy (Base Sepolia)", ["forge", "script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast", "--slow", ...verify]);
run("seed", ["forge", "script", "script/Seed.s.sol", "--rpc-url", rpc, "--broadcast", "--slow"]);
run("sync ABIs", ["node", "packages/shared/scripts/sync.mjs"], root);
console.log("\nDone. Addresses: packages/shared/src/addresses.json (key 84532). Commit them.");
