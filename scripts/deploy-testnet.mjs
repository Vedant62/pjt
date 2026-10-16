#!/usr/bin/env node
// `pnpm deploy:testnet [--chain 84532]` — deploy + seed + verify on a public testnet, then sync ABIs/addresses.
// Chain: --chain flag, else TESTNET_CHAIN, else 11155111 (Ethereum Sepolia). 84532 (Base Sepolia) is also supported.
// Reads contracts/.env: PRIVATE_KEY, SEPOLIA_RPC_URL / BASE_SEPOLIA_RPC_URL, ETHERSCAN_API_KEY, GATEWAY_ADDRESS, SUBSCRIBER_ADDRESSES.
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
const flag = process.argv.indexOf("--chain");
const chainId = Number(flag > 0 ? process.argv[flag + 1] : env.TESTNET_CHAIN || 11155111);
const CHAINS = {
  11155111: { name: "Ethereum Sepolia", rpc: env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", explorer: "Etherscan" },
  84532: { name: "Base Sepolia", rpc: env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org", explorer: "BaseScan" },
};
const c = CHAINS[chainId];
if (!c) (console.error(`unsupported testnet chain ${chainId}`), process.exit(1));
const rpc = c.rpc;
const verify = env.ETHERSCAN_API_KEY ? ["--verify", "--etherscan-api-key", env.ETHERSCAN_API_KEY, "--chain", String(chainId)] : [];
if (!verify.length) console.warn(`ETHERSCAN_API_KEY not set — deploying WITHOUT ${c.explorer} verification`);

const run = (label, args, cwd = join(root, "contracts")) => {
  console.log(`\n▸ ${label}`);
  const r = spawnSync(args[0], args.slice(1), { cwd, env, stdio: "inherit" });
  if (r.status !== 0) (console.error(`✗ ${label}`), process.exit(1));
};
run(`deploy (${c.name}, ${chainId})`, ["forge", "script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast", "--slow", ...verify]);
run("seed", ["forge", "script", "script/Seed.s.sol", "--rpc-url", rpc, "--broadcast", "--slow"]);
run("sync ABIs", ["node", "packages/shared/scripts/sync.mjs"], root);
console.log(`\nDone. Addresses: packages/shared/src/addresses.json (key ${chainId}). Commit them.`);
