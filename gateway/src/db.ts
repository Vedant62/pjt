import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface UsageRow {
  id: number;
  epoch: number;
  wallet: string;
  subId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  requestHash: string;
  responseHash: string;
  timestamp: number;
  gridJobId: string | null;
  ttftMs: number | null;
  totalMs: number;
  stream: number;
  usageSource: "upstream" | "estimated";
}

export interface EpochRecord {
  planId: string;
  epoch: number;
  root: string;
  rowCount: number;
  totalTokens: number;
  txHash: string;
  committedAt: number;
  file: string;
}

export type DB = ReturnType<typeof openDb>;

export function openDb(dataDir: string, file = "gateway.sqlite") {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(file === ":memory:" ? file : join(dataDir, file));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epoch INTEGER NOT NULL,
      wallet TEXT NOT NULL,
      subId TEXT NOT NULL,
      model TEXT NOT NULL,
      promptTokens INTEGER NOT NULL,
      completionTokens INTEGER NOT NULL,
      requestHash TEXT NOT NULL,
      responseHash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      gridJobId TEXT,
      ttftMs INTEGER,
      totalMs INTEGER NOT NULL,
      stream INTEGER NOT NULL DEFAULT 0,
      usageSource TEXT NOT NULL DEFAULT 'upstream'
    );
    CREATE INDEX IF NOT EXISTS usage_epoch ON usage(epoch);
    CREATE TABLE IF NOT EXISTS api_keys (
      hash TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      prefix TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS epochs (
      planId TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      root TEXT NOT NULL,
      rowCount INTEGER NOT NULL,
      totalTokens INTEGER NOT NULL,
      txHash TEXT NOT NULL,
      committedAt INTEGER NOT NULL,
      file TEXT NOT NULL,
      PRIMARY KEY (planId, epoch)
    );
    CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `);

  const q = {
    insertUsage: db.prepare(`INSERT INTO usage (epoch, wallet, subId, model, promptTokens, completionTokens, requestHash,
      responseHash, timestamp, gridJobId, ttftMs, totalMs, stream, usageSource) VALUES (@epoch, @wallet, @subId, @model,
      @promptTokens, @completionTokens, @requestHash, @responseHash, @timestamp, @gridJobId, @ttftMs, @totalMs, @stream,
      @usageSource)`),
    usageByEpoch: db.prepare(`SELECT * FROM usage WHERE epoch = ? ORDER BY id`),
    usageById: db.prepare(`SELECT * FROM usage WHERE id = ?`),
    usageByWallet: db.prepare(`SELECT * FROM usage WHERE wallet = ? ORDER BY id DESC LIMIT ?`),
    pendingEpochs: db.prepare(`SELECT DISTINCT u.epoch FROM usage u
      LEFT JOIN epochs e ON e.epoch = u.epoch AND e.planId = ? WHERE e.epoch IS NULL AND u.epoch < ? ORDER BY u.epoch`),
    insertEpoch: db.prepare(`INSERT INTO epochs VALUES (@planId, @epoch, @root, @rowCount, @totalTokens, @txHash, @committedAt, @file)`),
    listEpochs: db.prepare(`SELECT * FROM epochs WHERE planId = ? ORDER BY epoch DESC`),
    getEpoch: db.prepare(`SELECT * FROM epochs WHERE planId = ? AND epoch = ?`),
    insertKey: db.prepare(`INSERT INTO api_keys VALUES (?, ?, ?, ?)`),
    keyByHash: db.prepare(`SELECT * FROM api_keys WHERE hash = ?`),
    getCounter: db.prepare(`SELECT value FROM counters WHERE name = ?`),
    bumpCounter: db.prepare(`INSERT INTO counters (name, value) VALUES (?, 1)
      ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`),
  };

  return {
    raw: db,
    insertUsage: (r: Omit<UsageRow, "id">) => Number(q.insertUsage.run(r).lastInsertRowid),
    usageByEpoch: (epoch: number) => q.usageByEpoch.all(epoch) as UsageRow[],
    usageById: (id: number) => q.usageById.get(id) as UsageRow | undefined,
    usageByWallet: (wallet: string, limit = 50) => q.usageByWallet.all(wallet, limit) as UsageRow[],
    pendingEpochs: (planId: string, currentEpoch: number) =>
      (q.pendingEpochs.all(planId, currentEpoch) as { epoch: number }[]).map((r) => r.epoch),
    insertEpoch: (e: EpochRecord) => q.insertEpoch.run(e),
    listEpochs: (planId: string) => q.listEpochs.all(planId) as EpochRecord[],
    getEpoch: (planId: string, epoch: number) => q.getEpoch.get(planId, epoch) as EpochRecord | undefined,
    insertKey: (hash: string, wallet: string, prefix: string) => q.insertKey.run(hash, wallet, prefix, Date.now()),
    keyByHash: (hash: string) => q.keyByHash.get(hash) as { wallet: string } | undefined,
    counter: (name: string) => ((q.getCounter.get(name) as { value: number } | undefined)?.value ?? 0),
    bumpCounter: (name: string) => (q.bumpCounter.get(name) as { value: number }).value,
  };
}
