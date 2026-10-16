/**
 * results/batch_sweep.json — real receipt gasUsed of chargeBatch on a scratch anvil for batch sizes
 * 1, 5, 10, 25, 50, 100, 200 (steady state: keeper and payee balances already non-zero).
 *
 * Deviation: SPEC names GasSweep.s.sol. A forge-script simulation keeps storage warm across top-level calls
 * and omits intrinsic/calldata gas, so it under-reports what a keeper actually pays. This script sends real
 * transactions and reads receipts instead. (contracts/script/GasSweep.s.sol documents this and points here.)
 */
import { ANVIL_ACCOUNTS } from "@cashew/shared";
import { abis, clients, deployAll, meta, prepareSubscribers, sendAs, startAnvil, writeResult } from "./lib/common";

const SIZES = [1, 5, 10, 25, 50, 100, 200];
const PRICE = 20_000_000n;
const PERIOD = 180;

const anvil = await startAnvil(8546);
try {
  const c = clients(anvil.rpc);
  const k = await deployAll(c);
  const keeper = ANVIL_ACCOUNTS.keeper.address;
  await sendAs(c, c.account.address, { address: k.registry, abi: abis.registry, functionName: "createPlan", args: [k.usdc, PRICE, PERIOD, 60, c.account.address, "sweep"] });

  const n = Math.max(...SIZES);
  console.log(`preparing ${n} subscribers…`);
  const subs = await prepareSubscribers(c, k, n, PRICE * 20n);
  for (const s of subs) await sendAs(c, s, { address: k.vault, abi: abis.vault, functionName: "subscribe", args: [1n] });
  const ids = subs.map((_, i) => BigInt(i + 1));

  const advance = async () => {
    await c.test.increaseTime({ seconds: PERIOD });
    await c.test.mine({ blocks: 1 });
  };

  // Warm-up: first ever keeper fee credit (zero → non-zero claimable) is recorded separately.
  await advance();
  const first = await sendAs(c, keeper, { address: k.vault, abi: abis.vault, functionName: "charge", args: [ids[0]] });
  const single = await sendAs(c, keeper, { address: k.vault, abi: abis.vault, functionName: "charge", args: [ids[1]] });

  const rows = [];
  for (const size of SIZES) {
    await advance();
    const rc = await sendAs(c, keeper, { address: k.vault, abi: abis.vault, functionName: "chargeBatch", args: [ids.slice(0, size)] });
    if (rc.status !== "success") throw new Error(`batch ${size} reverted`);
    const charged = rc.logs.length; // sanity: one Charged + one Transfer per sub
    rows.push({ batchSize: size, totalGas: Number(rc.gasUsed), gasPerSubscriber: Math.round(Number(rc.gasUsed) / size), logs: charged, txHash: rc.transactionHash });
    console.log(`batch ${size}: ${rc.gasUsed} gas (${Math.round(Number(rc.gasUsed) / size)} / sub)`);
  }

  writeResult("batch_sweep.json", {
    ...meta("sim/src/batch-sweep.ts", { chain: "anvil (scratch, automine)", plan: { price: PRICE, period: PERIOD, grace: 60 }, keeperFeeBps: 25 }),
    note: "Receipt gasUsed of real transactions (includes 21,000 intrinsic + calldata). Steady state: payee and keeper claimable slots already non-zero.",
    singleCharge: { gasUsed: Number(single.gasUsed), txHash: single.transactionHash },
    firstEverKeeperCharge: { gasUsed: Number(first.gasUsed), note: "keeper claimable 0 → non-zero (cold SSTORE)" },
    sweep: rows,
  });
} finally {
  anvil.stop();
}
