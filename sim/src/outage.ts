/**
 * results/keeper_outage.json — run the REAL keeper process (keeper/src/index.ts) against a scratch anvil, stop it with
 * SIGTERM (graceful shutdown), advance chain time by 3 full periods with nobody charging, restart it, and check that
 * every missed charge is recovered (late, not lost) on the anchored schedule.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANVIL_ACCOUNTS } from "@cashew/shared";
import { ROOT, abis, clients, deployAll, meta, prepareSubscribers, sendAs, startAnvil, writeResult } from "./lib/common";

const N = 20;
const PERIOD = 180;
const GRACE = 60;
const PRICE = 20_000_000n;
const OUTAGE_PERIODS = 3;

const anvil = await startAnvil(8551);
const logDir = mkdtempSync(join(tmpdir(), "cashew-outage-"));
const logFile = join(logDir, "keeper.jsonl");
let keeperProc: ChildProcess | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  const c = clients(anvil.rpc);
  const k = await deployAll(c);
  await sendAs(c, c.account.address, { address: k.registry, abi: abis.registry, functionName: "createPlan", args: [k.usdc, PRICE, PERIOD, GRACE, c.account.address, "demo"] });
  const subs = await prepareSubscribers(c, k, N, PRICE * 10n);
  for (const s of subs) await sendAs(c, s, { address: k.vault, abi: abis.vault, functionName: "subscribe", args: [1n] });
  const ids = subs.map((_, i) => BigInt(i + 1));

  const readSubs = () => Promise.all(ids.map((id) => c.pub.readContract({ address: k.vault, abi: abis.vault, functionName: "getSubscription", args: [id] })));
  const chainNow = async () => Number((await c.pub.getBlock()).timestamp);
  const warp = async (s: number) => {
    await c.test.increaseTime({ seconds: s });
    await c.test.mine({ blocks: 1 });
  };
  const startKeeper = () => {
    // Spawn tsx directly (not via pnpm) so SIGTERM reaches the keeper process itself.
    const p = spawn(join(ROOT, "keeper/node_modules/.bin/tsx"), ["src/index.ts"], {
      cwd: join(ROOT, "keeper"),
      env: { ...process.env, RPC_URL: anvil.rpc, CHAIN_ID: "31337", KEEPER_PRIVATE_KEY: ANVIL_ACCOUNTS.keeper.key, VAULT_ADDRESS: k.vault, MUSDC_ADDRESS: k.usdc, TICK_SECONDS: "1", HEALTH_PORT: "8798", KEEPER_LOG_FILE: logFile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: string[] = [];
    p.stdout!.on("data", (d) => out.push(String(d)));
    p.stderr!.on("data", (d) => out.push(String(d)));
    return Object.assign(p, { out });
  };
  const waitUntil = async (pred: () => Promise<boolean>, ms: number, what: string) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (await pred()) return (Date.now() - t) / 1000;
      await sleep(500);
    }
    throw new Error(`timeout waiting for ${what}`);
  };

  // Phase 1: keeper running, one period elapses → every sub charged once.
  keeperProc = startKeeper();
  await warp(PERIOD + 1);
  await waitUntil(async () => (await readSubs()).every((s) => s.chargeCount === 2), 60_000, "first charges");
  const beforeOutage = await readSubs();

  // Phase 2: graceful stop.
  const stopAt = await chainNow();
  const exit = new Promise<number | null>((res) => keeperProc!.on("exit", (code) => res(code)));
  keeperProc.kill("SIGTERM");
  const exitCode = await exit;
  const stopLog = (keeperProc as any).out.join("").includes("SIGTERM received");
  keeperProc = null;

  // Phase 3: outage of 3 full periods (well past the 60 s grace).
  await warp(OUTAGE_PERIODS * PERIOD + 5);
  const duringOutage = await readSubs();
  const chargedDuringOutage = duringOutage.reduce((n, s, i) => n + (s.chargeCount - beforeOutage[i].chargeCount), 0);
  const restartAt = await chainNow();

  // Phase 4: restart; it must catch up every missed period.
  const linesBefore = readFileSync(logFile, "utf8").trim().split("\n").length;
  keeperProc = startKeeper();
  const catchUpSeconds = await waitUntil(async () => {
    const now = await chainNow();
    return (await readSubs()).every((s) => Number(s.nextChargeAt) > now);
  }, 120_000, "catch-up");
  const exit2 = new Promise<number | null>((res) => keeperProc!.on("exit", (code) => res(code)));
  keeperProc.kill("SIGTERM");
  await exit2;
  keeperProc = null;

  const end = await readSubs();
  const endNow = await chainNow();
  const all = readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const recoveredLines = all.slice(linesBefore).filter((l) => l.outcome === "charged");
  const expected = end.map((s) => 1 + Math.floor((endNow - Number(s.startedAt)) / PERIOD));
  const actual = end.map((s) => s.chargeCount);
  const lost = expected.reduce((a, e, i) => a + (e - actual[i]), 0);
  const anchoredOk = end.every((s) => Number(s.nextChargeAt) === Number(s.startedAt) + PERIOD * s.chargeCount);

  const seq = (subId: number) => all.filter((l) => l.subId === subId && l.outcome === "charged").map((l) => ({ scheduledAt: l.scheduledAt, executedAt: l.executedAt, driftSeconds: l.driftSeconds, txHash: l.txHash }));

  writeResult("keeper_outage.json", {
    ...meta("sim/src/outage.ts", { chain: "anvil (scratch, automine) + real keeper process", plan: { price: PRICE, periodSeconds: PERIOD, graceSeconds: GRACE }, subscribers: N }),
    gracefulShutdown: { signal: "SIGTERM", exitCode, loggedShutdown: stopLog },
    outage: { periods: OUTAGE_PERIODS, stoppedAtChainTime: stopAt, restartedAtChainTime: restartAt, outageSeconds: restartAt - stopAt, chargesDuringOutage: chargedDuringOutage },
    recovery: {
      chargesRecovered: recoveredLines.length,
      expectedRecovered: N * OUTAGE_PERIODS,
      catchUpWallSeconds: catchUpSeconds,
      keeperTxsDuringRecovery: new Set(recoveredLines.map((l) => l.txHash)).size,
      maxDriftSeconds: Math.max(...recoveredLines.map((l) => l.driftSeconds)),
    },
    totals: { expectedCharges: expected.reduce((a, b) => a + b, 0), actualCharges: actual.reduce((a, b) => a + b, 0), lost },
    anchoredScheduleHolds: anchoredOk,
    lapsed: end.filter((s) => s.status === 3).length,
    nextChargeAtSequence: {
      note: "sub #1: every charge settles the next anchored slot startedAt + k·period, even when executed late",
      startedAt: Number(end[0].startedAt),
      charges: seq(1),
    },
  });
  console.log(`recovered ${recoveredLines.length}, lost ${lost}, anchored ${anchoredOk}, exit ${exitCode}`);
} finally {
  keeperProc?.kill("SIGKILL");
  anvil.stop();
  rmSync(logDir, { recursive: true, force: true });
}
