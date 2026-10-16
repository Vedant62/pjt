import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { subscriptionVaultAbi } from "@cashew/shared";

export type Outcome = "charged" | "failed" | "lapsed" | "skipped";

export interface KeeperLogLine {
  ts: number; // wall clock ms
  subId: number;
  scheduledAt: number; // the nextChargeAt that was due
  executedAt: number; // block timestamp of inclusion
  driftSeconds: number;
  outcome: Outcome;
  reason?: string;
  txHash: Hash;
  gasUsed: number; // gas of the whole chargeBatch tx
  batchSize: number;
}

export interface TickResult {
  startedAt: number;
  due: number;
  charged: number;
  failed: number;
  lapsed: number;
  skipped: number;
  txs: number;
  gasUsed: bigint;
  lines: KeeperLogLine[];
}

export interface KeeperOptions {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
  vault: Address;
  batchSize?: number;
  pageSize?: number;
  /** Max re-scan rounds per tick (lets a late keeper catch up several periods in one tick). */
  maxRounds?: number;
  logFile?: string | null;
  log?: (msg: string) => void;
}

/**
 * Permissionless keeper: finds due subscriptions and charges them in batches.
 * It holds no privileges — the vault enforces amount and timing.
 */
export class Keeper {
  readonly opts: Required<Omit<KeeperOptions, "logFile" | "log">> & Pick<KeeperOptions, "logFile" | "log">;
  lastTick: TickResult | null = null;
  lastQueueSize = 0;
  ticking = false;

  constructor(opts: KeeperOptions) {
    this.opts = { batchSize: 100, pageSize: 500, maxRounds: 16, ...opts };
    if (opts.logFile) mkdirSync(dirname(opts.logFile), { recursive: true });
  }

  /** Page through dueSubscriptions(cursor, pageSize). */
  async findDue(): Promise<bigint[]> {
    const { publicClient, vault, pageSize } = this.opts;
    const ids: bigint[] = [];
    let cursor = 0n;
    do {
      const [page, next] = await publicClient.readContract({
        address: vault,
        abi: subscriptionVaultAbi,
        functionName: "dueSubscriptions",
        args: [cursor, BigInt(pageSize)],
      });
      ids.push(...page);
      cursor = next;
    } while (cursor !== 0n);
    return ids;
  }

  async tick(): Promise<TickResult> {
    if (this.ticking) throw new Error("tick already in progress");
    this.ticking = true;
    const res: TickResult = {
      startedAt: Date.now(),
      due: 0,
      charged: 0,
      failed: 0,
      lapsed: 0,
      skipped: 0,
      txs: 0,
      gasUsed: 0n,
      lines: [],
    };
    try {
      // Subs that failed this tick (PastDue) stay "due"; don't retry them until the next tick.
      const triedFailed = new Set<bigint>();
      for (let round = 0; round < this.opts.maxRounds; round++) {
        const due = (await this.findDue()).filter((id) => !triedFailed.has(id));
        if (round === 0) this.lastQueueSize = due.length;
        if (due.length === 0) break;
        res.due += due.length;
        for (let i = 0; i < due.length; i += this.opts.batchSize) {
          const chunk = due.slice(i, i + this.opts.batchSize);
          const lines = await this.chargeChunk(chunk);
          res.txs++;
          res.gasUsed += BigInt(lines[0]?.gasUsed ?? 0);
          for (const l of lines) {
            res.lines.push(l);
            if (l.outcome === "charged") res.charged++;
            else if (l.outcome === "failed") (res.failed++, triedFailed.add(BigInt(l.subId)));
            else if (l.outcome === "lapsed") res.lapsed++;
            else (res.skipped++, triedFailed.add(BigInt(l.subId)));
          }
        }
      }
    } finally {
      this.ticking = false;
    }
    this.lastTick = res;
    return res;
  }

  private async chargeChunk(ids: bigint[]): Promise<KeeperLogLine[]> {
    const { publicClient, walletClient, vault } = this.opts;
    const subs = await Promise.all(
      ids.map((id) =>
        publicClient.readContract({ address: vault, abi: subscriptionVaultAbi, functionName: "getSubscription", args: [id] }),
      ),
    );
    const scheduled = new Map(ids.map((id, i) => [id, Number(subs[i].nextChargeAt)]));

    const { request } = await publicClient.simulateContract({
      account: walletClient.account,
      address: vault,
      abi: subscriptionVaultAbi,
      functionName: "chargeBatch",
      args: [ids],
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`chargeBatch reverted: ${hash}`);
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const executedAt = Number(block.timestamp);

    const events = parseEventLogs({ abi: subscriptionVaultAbi, logs: receipt.logs });
    const outcome = new Map<bigint, { outcome: Outcome; reason?: string }>();
    for (const ev of events) {
      if (ev.eventName === "Charged") outcome.set(ev.args.subId, { outcome: "charged" });
      else if (ev.eventName === "ChargeFailed")
        outcome.set(ev.args.subId, { outcome: "failed", reason: ev.args.reason === 1 ? "balance" : "allowance" });
      else if (ev.eventName === "SubscriptionLapsed") outcome.set(ev.args.subId, { outcome: "lapsed" });
    }

    const lines: KeeperLogLine[] = ids.map((id) => {
      const o = outcome.get(id) ?? { outcome: "skipped" as const };
      const scheduledAt = scheduled.get(id)!;
      return {
        ts: Date.now(),
        subId: Number(id),
        scheduledAt,
        executedAt,
        driftSeconds: executedAt - scheduledAt,
        ...o,
        txHash: hash,
        gasUsed: Number(receipt.gasUsed),
        batchSize: ids.length,
      };
    });
    if (this.opts.logFile) appendFileSync(this.opts.logFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const c = lines.filter((l) => l.outcome === "charged").length;
    this.opts.log?.(`chargeBatch(${ids.length}) → ${c} charged, ${lines.length - c} other · gas ${receipt.gasUsed} · ${hash}`);
    return lines;
  }
}
