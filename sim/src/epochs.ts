/** results/epochs.json — committed epochs as reported by the running gateway, plus one inclusion proof verified on-chain. */
import "dotenv/config";
import { createPublicClient, http, type Hex } from "viem";
import { chainFor, getDeployment, usageRootRegistryAbi } from "@cashew/shared";
import { meta, writeResult } from "./lib/common";

const GW = (process.env.GATEWAY_URL ?? "http://localhost:8787").replace(/\/$/, "");
const health = await (await fetch(`${GW}/health`)).json();
const chainId = Number(health.chainId);
const rpc = chainId === 84532 ? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org" : process.env.RPC_URL ?? "http://127.0.0.1:8545";
const pub = createPublicClient({ chain: chainFor(chainId, rpc), transport: http(rpc) });
const dep = getDeployment(chainId);
const list = await (await fetch(`${GW}/epochs`)).json();

let verified: any = null;
const latest = list.epochs[0];
if (latest) {
  const rows = (await (await fetch(`${GW}/epochs/${latest.epoch}/rows`)).json()).rows;
  const p = await (await fetch(`${GW}/epochs/${latest.epoch}/proof/${rows[0].id}`)).json();
  const reg = { address: dep.UsageRootRegistry, abi: usageRootRegistryAbi } as const;
  const [onchainRoot, ok] = await Promise.all([
    pub.readContract({ ...reg, functionName: "rootOf", args: [BigInt(p.planId), BigInt(latest.epoch)] }),
    pub.readContract({ ...reg, functionName: "verifyRow", args: [BigInt(p.planId), BigInt(latest.epoch), p.proof as Hex[], p.leafHash as Hex] }),
  ]);
  verified = { epoch: latest.epoch, rowId: rows[0].id, leaf: p.leaf, leafHash: p.leafHash, proof: p.proof, gatewayRoot: p.root, onchainRoot, verifyRow: ok };
}

writeResult("epochs.json", {
  ...meta("sim/src/epochs.ts", { gateway: GW, chainId, mode: health.mode, epochSeconds: list.epochSeconds, registry: dep.UsageRootRegistry }),
  epochs: list.epochs,
  totals: { epochs: list.epochs.length, rows: list.epochs.reduce((n: number, e: any) => n + e.rowCount, 0), tokens: list.epochs.reduce((n: number, e: any) => n + e.totalTokens, 0) },
  verifiedInclusionProof: verified,
});
