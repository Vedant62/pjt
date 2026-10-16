/**
 * results/schedule_sim.json — 500 subscribers with staggered start times on a 30-day / 3-day-grace plan, simulated for
 * 12 periods on a scratch anvil (evm time travel). For each keeper tick interval (60 s, 600 s, 3600 s, 21600 s) the
 * real Keeper class runs at every tick time t_j = T0 + j·T. Ticks where nothing is due are counted but not executed
 * (nothing would happen on-chain). Each keeper tx is mined 2 s after the tick (one Base block).
 */
import { Keeper } from "@cashew/keeper";
import { ANVIL_ACCOUNTS } from "@cashew/shared";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { foundry } from "viem/chains";
import { abis, clients, deployAll, meta, prepareSubscribers, quantile, sendAs, startAnvil, writeResult } from "./lib/common";

const N = Number(process.env.SIM_SUBSCRIBERS ?? 500);
const PERIODS = Number(process.env.SIM_PERIODS ?? 12);
const PERIOD = 30 * 86_400;
const GRACE = 3 * 86_400;
const PRICE = 20_000_000n;
const TICKS = (process.env.SIM_TICKS ?? "60,600,3600,21600").split(",").map(Number);
const BLOCK_DELAY = 2;

/** Seeded PRNG (mulberry32) so start-time jitter is reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = Number(process.env.SIM_SEED ?? 42);
const stagger = PERIOD / N;

/** Each tick interval runs on its own fresh anvil with an identical setup (same seed → same start times). */
async function runInterval(T: number, port: number) {
  const anvil = await startAnvil(port);
  try {
    const c = clients(anvil.rpc);
    const k = await deployAll(c);
    await sendAs(c, c.account.address, { address: k.registry, abi: abis.registry, functionName: "createPlan", args: [k.usdc, PRICE, PERIOD, GRACE, c.account.address, "monthly"] });
    const subs = await prepareSubscribers(c, k, N, PRICE * BigInt(PERIODS + 2));

    // Start times: one per stagger slot, uniformly jittered inside the slot, so due times do not line up with the tick grid.
    const rand = rng(SEED);
    const T0 = Math.ceil(Number((await c.pub.getBlock()).timestamp) / 86_400) * 86_400 + 86_400; // a UTC midnight
    for (let i = 0; i < N; i++) {
      await c.test.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(T0 + i * stagger + rand() * (stagger - 1))) });
      await sendAs(c, subs[i], { address: k.vault, abi: abis.vault, functionName: "subscribe", args: [1n] });
    }
    const starts = await Promise.all(subs.map((_, i) => c.pub.readContract({ address: k.vault, abi: abis.vault, functionName: "getSubscription", args: [BigInt(i + 1)] })));
    const horizon = T0 + PERIODS * PERIOD;
    const expectedDue = starts.reduce((n, s) => n + Math.max(0, Math.floor((horizon - Number(s.startedAt)) / PERIOD)), 0);

    const keeperAcct = privateKeyToAccount(ANVIL_ACCOUNTS.keeper.key);
    const walletClient = createWalletClient({ chain: foundry, account: keeperAcct, transport: http(anvil.rpc) });
    const keeper = new Keeper({ publicClient: c.pub as any, walletClient: walletClient as any, vault: k.vault, batchSize: 100, pageSize: 500, logFile: null });

    const next = new Map<number, number>(starts.map((s, i) => [i + 1, Number(s.nextChargeAt)]));
    const ticksTotal = Math.floor((horizon - T0) / T);
    const tickRows: any[] = [];
    const drifts: number[] = [];
    let executed = 0,
      missed = 0,
      failed = 0,
      gasTotal = 0n,
      txs = 0,
      lastTick = -1;
    const t0 = Date.now();
    for (;;) {
      let minNext = Infinity;
      for (const v of next.values()) if (v < minNext) minNext = v;
      const j = Math.max(lastTick + 1, Math.ceil((minNext - T0) / T));
      const t = T0 + j * T;
      if (t > horizon) break;
      lastTick = j;
      const dueIds = [...next.entries()].filter(([, v]) => v <= t).map(([id]) => id);
      await c.test.setNextBlockTimestamp({ timestamp: BigInt(t) });
      await c.test.mine({ blocks: 1 });
      await c.test.setNextBlockTimestamp({ timestamp: BigInt(t + BLOCK_DELAY) });
      const r = await keeper.tick();
      const charged = r.lines.filter((l) => l.outcome === "charged");
      for (const l of charged) {
        drifts.push(l.driftSeconds);
        next.set(l.subId, l.scheduledAt + PERIOD);
      }
      executed += charged.length;
      failed += r.failed + r.lapsed;
      const miss = Math.max(0, dueIds.length - new Set(charged.map((l) => l.subId)).size);
      missed += miss;
      gasTotal += r.gasUsed;
      txs += r.txs;
      const ds = charged.map((l) => l.driftSeconds).sort((a, b) => a - b);
      tickRows.push({ tick: j, t, due: dueIds.length, executed: charged.length, missed: miss, driftP50: quantile(ds, 0.5), driftP95: quantile(ds, 0.95), driftMax: ds.at(-1) ?? null, txs: r.txs, gasUsed: Number(r.gasUsed) });
      if (tickRows.length % 1000 === 0) console.log(`  T=${T}s: ${tickRows.length} active ticks, ${executed} charges, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    drifts.sort((a, b) => a - b);
    const res = {
      tickSeconds: T,
      ticksTotal,
      ticksWithWork: tickRows.length,
      ticksEmpty: ticksTotal - tickRows.length,
      dueCharges: expectedDue,
      executed,
      missed,
      failedOrLapsed: failed,
      lost: expectedDue - executed,
      drift: { p50: quantile(drifts, 0.5), p95: quantile(drifts, 0.95), max: drifts.at(-1) ?? null, mean: drifts.reduce((a, b) => a + b, 0) / (drifts.length || 1) },
      gasTotal: Number(gasTotal),
      txs,
      gasPerCharge: executed ? Math.round(Number(gasTotal) / executed) : null,
      wallSeconds: (Date.now() - t0) / 1000,
      driftSamples: drifts,
      ticks: tickRows,
    };
    console.log(`T=${T}s → executed ${executed}/${expectedDue}, missed ${missed}, drift p50 ${res.drift.p50}s p95 ${res.drift.p95}s max ${res.drift.max}s, ${txs} txs`);
    return res;
  } finally {
    anvil.stop();
  }
}

{
  // Intervals are independent, so they run in parallel on separate anvils.
  const results = await Promise.all(TICKS.map((T, i) => runInterval(T, 8547 + i)));
  writeResult("schedule_sim.json", {
    ...meta("sim/src/schedule.ts", {
      chain: "anvil (scratch) with evm_setNextBlockTimestamp time travel",
      subscribers: N,
      periods: PERIODS,
      plan: { price: PRICE, periodSeconds: PERIOD, graceSeconds: GRACE },
      stagger: `one start per ${stagger.toFixed(1)} s slot across the first period, uniformly jittered within the slot (seed ${SEED})`,
      keeper: "keeper/src/keeper.ts (batchSize 100, pageSize 500)",
      inclusionDelaySeconds: BLOCK_DELAY,
    }),
    note: "drift = block timestamp of the charge − the nextChargeAt it settled. 'ticks' lists only ticks where something was due; ticksEmpty did no work. missed = due at a tick but not charged in that tick.",
    results,
  });
}
