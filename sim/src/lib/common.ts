import { spawn, execSync, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  publicActions,
  walletActions,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ANVIL_ACCOUNTS, mockUSDCAbi, planRegistryAbi, subscriptionVaultAbi, usageRootRegistryAbi } from "@cashew/shared";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const RESULTS = join(ROOT, "results");

export function writeResult(name: string, data: unknown) {
  mkdirSync(RESULTS, { recursive: true });
  const p = join(RESULTS, name);
  writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  console.log(`wrote ${p}`);
}

export function readResult<T = any>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(join(RESULTS, name), "utf8"));
  } catch {
    return null;
  }
}

export function gitInfo() {
  const sh = (c: string) => {
    try {
      return execSync(c, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return null;
    }
  };
  return { commit: sh("git rev-parse --short HEAD"), dirty: (sh("git status --porcelain") ?? "").length > 0 };
}

export function meta(script: string, extra: Record<string, unknown> = {}) {
  return { script, generatedAt: new Date().toISOString(), git: gitInfo(), ...extra };
}

export function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Start a throwaway anvil (automine, no block time) for experiments. */
export async function startAnvil(port: number, extra: string[] = []): Promise<{ proc: ChildProcess; rpc: string; stop: () => void }> {
  const proc = spawn("anvil", ["--port", String(port), "--silent", "--gas-limit", "100000000", ...extra], { stdio: "ignore" });
  const rpc = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return { proc, rpc, stop: () => proc.kill("SIGTERM") };
}

export function clients(rpc: string, key: Hex = ANVIL_ACCOUNTS.deployer.key) {
  const account = privateKeyToAccount(key);
  const transport = http(rpc, { batch: { batchSize: 200 } });
  const test = createTestClient({ chain: foundry, mode: "anvil", transport }).extend(publicActions).extend(walletActions);
  const wallet = createWalletClient({ chain: foundry, account, transport });
  const pub = createPublicClient({ chain: foundry, transport });
  return { test, wallet, pub, account };
}

function artifact(name: string): { abi: any; bytecode: Hex } {
  const a = JSON.parse(readFileSync(join(ROOT, "contracts/out", `${name}.sol`, `${name}.json`), "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.object };
}

export interface Contracts {
  usdc: Address;
  registry: Address;
  vault: Address;
  roots: Address;
}

/** Deploy fresh Cashew contracts from the Foundry artifacts (run `forge build` first). */
export async function deployAll(c: ReturnType<typeof clients>, keeperFeeBps = 25): Promise<Contracts> {
  const deploy = async (name: string, args: unknown[] = []) => {
    const { abi, bytecode } = artifact(name);
    const hash = await c.wallet.deployContract({ abi, bytecode, args });
    const rc = await c.pub.waitForTransactionReceipt({ hash });
    return rc.contractAddress!;
  };
  const usdc = await deploy("MockUSDC");
  const registry = await deploy("PlanRegistry");
  const vault = await deploy("SubscriptionVault", [registry, keeperFeeBps]);
  const roots = await deploy("UsageRootRegistry", [c.account.address]);
  return { usdc, registry, vault, roots };
}

export const abis = { usdc: mockUSDCAbi, registry: planRegistryAbi, vault: subscriptionVaultAbi, roots: usageRootRegistryAbi };

/** Send from an impersonated address and wait. */
export async function sendAs(c: ReturnType<typeof clients>, from: Address, req: { address: Address; abi: any; functionName: string; args?: unknown[] }) {
  const hash = await c.test.writeContract({ ...req, account: from, chain: foundry } as any);
  return c.pub.waitForTransactionReceipt({ hash });
}

/** Deterministic pseudo-random address for subscriber i. */
export const simAddr = (i: number) => (`0x${(0x5ce11000000n + BigInt(i)).toString(16).padStart(40, "0")}`) as Address;

/** Fund + approve + impersonate a batch of subscriber addresses. */
export async function prepareSubscribers(c: ReturnType<typeof clients>, k: Contracts, n: number, mintEach: bigint) {
  const addrs = Array.from({ length: n }, (_, i) => simAddr(i));
  for (const a of addrs) {
    await c.test.impersonateAccount({ address: a });
    await c.test.setBalance({ address: a, value: 10n ** 20n });
    let left = mintEach;
    while (left > 0n) {
      const amt = left > 1_000_000_000n ? 1_000_000_000n : left;
      await sendAs(c, a, { address: k.usdc, abi: mockUSDCAbi, functionName: "mint", args: [a, amt] });
      left -= amt;
    }
    await sendAs(c, a, { address: k.usdc, abi: mockUSDCAbi, functionName: "approve", args: [k.vault, 2n ** 256n - 1n] });
  }
  return addrs;
}
