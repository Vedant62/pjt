import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { usageRootRegistryAbi, USAGE_LEAF_TYPES, USAGE_LEAF_FIELDS } from "@cashew/shared";
import type { Hex } from "viem";
import type { GatewayConfig } from "./config";
import type { DB, UsageRow } from "./db";
import type { ChainCtx } from "./chain";

export type LeafValues = [string, string, string, string, string, string, string, string, string];

export function rowToLeaf(r: UsageRow): LeafValues {
  return [
    String(r.epoch),
    r.wallet,
    r.subId,
    r.model,
    String(r.promptTokens),
    String(r.completionTokens),
    r.requestHash,
    r.responseHash,
    String(r.timestamp),
  ];
}

export interface EpochFile {
  planId: string;
  epoch: number;
  root: string;
  rowIds: number[];
  totalTokens: number;
  tree: ReturnType<StandardMerkleTree<LeafValues>["dump"]>;
}

export class EpochJob {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  lastCommitted: { epoch: number; txHash: string } | null = null;
  lastError: string | null = null;

  constructor(
    private cfg: GatewayConfig,
    private db: DB,
    private ctx: ChainCtx,
    private log: (m: string) => void = () => {},
  ) {
    mkdirSync(cfg.epochDir, { recursive: true });
    const latest = db.listEpochs(String(cfg.planId))[0];
    if (latest) this.lastCommitted = { epoch: latest.epoch, txHash: latest.txHash };
  }

  epochOf(tsSeconds: number) {
    return Math.floor(tsSeconds / this.cfg.epochSeconds);
  }

  currentEpoch() {
    return this.epochOf(Math.floor(Date.now() / 1000));
  }

  start() {
    const every = Math.max(1000, Math.min(30_000, (this.cfg.epochSeconds * 1000) / 5));
    this.timer = setInterval(() => void this.runOnce().catch(() => {}), every);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Commit every closed epoch (< current, or <= `upTo` if given) that has rows and no root yet. Empty epochs are skipped. */
  async runOnce(upTo?: number): Promise<number[]> {
    if (this.running) return [];
    this.running = true;
    const done: number[] = [];
    try {
      const limit = upTo === undefined ? this.currentEpoch() : upTo + 1;
      for (const epoch of this.db.pendingEpochs(String(this.cfg.planId), limit)) {
        await this.commit(epoch);
        done.push(epoch);
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = (e as Error).message.split("\n")[0];
      this.log(`epoch commit error: ${this.lastError}`);
      throw e;
    } finally {
      this.running = false;
    }
    return done;
  }

  filePath(epoch: number) {
    return join(this.cfg.epochDir, `${this.cfg.planId}-${epoch}.json`);
  }

  loadFile(epoch: number): EpochFile | null {
    const p = this.filePath(epoch);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as EpochFile) : null;
  }

  private async commit(epoch: number) {
    const rows = this.db.usageByEpoch(epoch);
    if (rows.length === 0) return;
    const values = rows.map(rowToLeaf);
    const tree = StandardMerkleTree.of(values, [...USAGE_LEAF_TYPES]);
    const totalTokens = rows.reduce((n, r) => n + r.promptTokens + r.completionTokens, 0);
    const file: EpochFile = {
      planId: String(this.cfg.planId),
      epoch,
      root: tree.root,
      rowIds: rows.map((r) => r.id),
      totalTokens,
      tree: tree.dump(),
    };
    writeFileSync(this.filePath(epoch), JSON.stringify(file, null, 2));

    const { publicClient, walletClient, dep } = this.ctx;
    const registry = { address: dep.UsageRootRegistry, abi: usageRootRegistryAbi } as const;
    const existing = await publicClient.readContract({ ...registry, functionName: "rootOf", args: [this.cfg.planId, BigInt(epoch)] });
    let txHash: Hex;
    if (existing !== "0x" + "0".repeat(64)) {
      if (existing.toLowerCase() !== tree.root.toLowerCase())
        throw new Error(`epoch ${epoch} already has a different root on-chain (${existing})`);
      txHash = "0x" as Hex; // committed earlier (e.g. DB restored); nothing to send
    } else {
      const uri = `${process.env.GATEWAY_PUBLIC_URL ?? `http://localhost:${this.cfg.port}`}/epochs/${epoch}/tree`;
      const { request } = await publicClient.simulateContract({
        ...registry,
        account: walletClient.account,
        functionName: "commitRoot",
        args: [this.cfg.planId, BigInt(epoch), tree.root as Hex, BigInt(rows.length), BigInt(totalTokens), uri],
      });
      txHash = await walletClient.writeContract(request);
      const rc = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (rc.status !== "success") throw new Error(`commitRoot reverted ${txHash}`);
    }
    this.db.insertEpoch({
      planId: String(this.cfg.planId),
      epoch,
      root: tree.root,
      rowCount: rows.length,
      totalTokens,
      txHash,
      committedAt: Math.floor(Date.now() / 1000),
      file: this.filePath(epoch),
    });
    this.lastCommitted = { epoch, txHash };
    this.log(`committed epoch ${epoch}: ${rows.length} rows, ${totalTokens} tokens, root ${tree.root.slice(0, 10)}… tx ${txHash}`);
  }

  proof(epoch: number, rowId: number) {
    const f = this.loadFile(epoch);
    if (!f) return null;
    const idx = f.rowIds.indexOf(rowId);
    if (idx < 0) return null;
    const tree = StandardMerkleTree.load(f.tree);
    const values = tree.at(idx)!;
    const leaf = Object.fromEntries(USAGE_LEAF_FIELDS.map((k, i) => [k, values[i]]));
    return {
      planId: f.planId,
      epoch,
      rowId,
      root: f.root,
      values,
      leaf,
      leafHash: tree.leafHash(values),
      proof: tree.getProof(idx),
      txHash: this.db.getEpoch(f.planId, epoch)?.txHash ?? null,
    };
  }
}
