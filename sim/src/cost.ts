/**
 * results/cost_model.json — measured gas × gas prices.
 * MEASURED: gas (batch_sweep.json receipts, gas_report.json), Base Sepolia eth_gasPrice and the L1 data fee quoted by
 * Base Sepolia's GasPriceOracle predeploy at run time.
 * ASSUMED (labelled): a Base-mainnet-like L2 gas price and ETH/USD. Change via env.
 */
import "dotenv/config";
import { createPublicClient, encodeFunctionData, http, parseAbi, serializeTransaction, formatGwei, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { subscriptionVaultAbi } from "@cashew/shared";
import { meta, readResult, writeResult } from "./lib/common";

const ASSUME_GWEI = Number(process.env.ASSUME_BASE_MAINNET_GAS_GWEI ?? 0.01);
const ASSUME_ETH_USD = Number(process.env.ASSUME_ETH_USD ?? 3000);
const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const CYCLE_USD = 20; // 20 mUSDC plan, treated as 20 USD for the ratio

const sweep = readResult("batch_sweep.json");
const gas = readResult("gas_report.json");
if (!sweep || !gas) throw new Error("run batch-sweep and gas-report first");

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const oracle = { address: "0x420000000000000000000000000000000000000F", abi: parseAbi(["function getL1Fee(bytes) view returns (uint256)"]) } as const;

let observed: { gasPriceWei: bigint; blockNumber: bigint } | null = null;
let observedError: string | null = null;
try {
  const [gasPriceWei, blockNumber] = await Promise.all([client.getGasPrice(), client.getBlockNumber()]);
  observed = { gasPriceWei, blockNumber };
} catch (e) {
  observedError = (e as Error).message.split("\n")[0];
}

async function l1Fee(data: Hex): Promise<bigint | null> {
  if (!observed) return null;
  try {
    // Representative unsigned EIP-1559 tx to the vault; the oracle adds its own signature overhead model.
    const tx = serializeTransaction({ chainId: 84532, type: "eip1559", to: "0x" + "11".repeat(20) as Hex, data, nonce: 100, gas: 1_000_000n, maxFeePerGas: observed.gasPriceWei, maxPriorityFeePerGas: 1_000_000n });
    return await client.readContract({ ...oracle, functionName: "getL1Fee", args: [tx] });
  } catch {
    return null;
  }
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => BigInt(i + 1_000));
type Op = { op: string; gas: number; gasSource: string; calldata: Hex };
const ops: Op[] = [
  { op: "charge (single tx)", gas: sweep.singleCharge.gasUsed, gasSource: "receipt (batch_sweep.json)", calldata: encodeFunctionData({ abi: subscriptionVaultAbi, functionName: "charge", args: [1_000n] }) },
  ...sweep.sweep.map((r: any) => ({
    op: `chargeBatch(${r.batchSize})`,
    gas: r.totalGas,
    gasSource: "receipt (batch_sweep.json)",
    calldata: encodeFunctionData({ abi: subscriptionVaultAbi, functionName: "chargeBatch", args: [ids(r.batchSize)] }),
  })),
  ...["subscribeWithPermit", "subscribe", "cancel", "withdraw", "createPlan", "commitRoot"]
    .filter((o) => gas.ops[o])
    .map((o) => ({ op: o, gas: gas.ops[o].median + 21_000, gasSource: "gas_report median execution gas + 21,000 intrinsic (calldata gas not included)", calldata: "0x" as Hex })),
];

const usd = (wei: bigint | number) => (Number(wei) / 1e18) * ASSUME_ETH_USD;
const rows = [];
for (const o of ops) {
  const l1 = o.calldata !== "0x" ? await l1Fee(o.calldata) : null;
  const batch = /chargeBatch\((\d+)\)/.exec(o.op);
  const perSub = batch ? Number(batch[1]) : 1;
  const sepoliaL2Wei = observed ? BigInt(o.gas) * observed.gasPriceWei : null;
  const assumedL2Wei = (BigInt(o.gas) * BigInt(Math.round(ASSUME_GWEI * 1e9)));
  const sepTotal = sepoliaL2Wei !== null ? sepoliaL2Wei + (l1 ?? 0n) : null;
  rows.push({
    op: o.op,
    gas: o.gas,
    gasSource: o.gasSource,
    subscribersCovered: perSub,
    baseSepolia: sepTotal === null ? null : {
      l2ExecutionWei: sepoliaL2Wei,
      l1DataFeeWei: l1,
      totalWei: sepTotal,
      totalUsd: usd(sepTotal),
      perSubscriberUsd: usd(sepTotal) / perSub,
      pctOf20UsdCyclePerSubscriber: (usd(sepTotal) / perSub / CYCLE_USD) * 100,
    },
    assumedMainnetL2Only: {
      l2ExecutionWei: assumedL2Wei,
      totalUsd: usd(assumedL2Wei),
      perSubscriberUsd: usd(assumedL2Wei) / perSub,
      pctOf20UsdCyclePerSubscriber: (usd(assumedL2Wei) / perSub / CYCLE_USD) * 100,
      l1DataFeeExcluded: true,
    },
  });
}

writeResult("cost_model.json", {
  ...meta("sim/src/cost.ts"),
  measured: {
    baseSepoliaGasPriceWei: observed?.gasPriceWei ?? null,
    baseSepoliaGasPriceGwei: observed ? formatGwei(observed.gasPriceWei) : null,
    atBlock: observed?.blockNumber ?? null,
    rpc: RPC,
    l1FeeSource: "Base Sepolia GasPriceOracle 0x4200…000F getL1Fee(serialized unsigned tx) at run time",
    error: observedError,
  },
  assumptions: {
    ethUsd: { value: ASSUME_ETH_USD, label: "ASSUMPTION (env ASSUME_ETH_USD)" },
    baseMainnetL2GasPriceGwei: { value: ASSUME_GWEI, label: "ASSUMPTION (env ASSUME_BASE_MAINNET_GAS_GWEI); L1 data fee NOT included in this scenario" },
    cycleUsd: { value: CYCLE_USD, label: "20 mUSDC plan price treated as 20 USD" },
    keeperFee: "Keeper reward (0.25% of price = 0.05 USD) is a transfer from subscriber to keeper, not a gas cost; compare it with perSubscriberUsd to see whether keeping is profitable.",
  },
  rows,
});
