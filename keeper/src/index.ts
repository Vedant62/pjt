import "dotenv/config";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor, getDeployment, subscriptionVaultAbi } from "@cashew/shared";
import { Keeper } from "./keeper";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

const CHAIN_ID = Number(env("CHAIN_ID", "31337"));
const RPC_URL = env("RPC_URL", "http://127.0.0.1:8545");
const TICK_SECONDS = Number(env("TICK_SECONDS", "15"));
const BATCH_SIZE = Number(env("BATCH_SIZE", "100"));
const HEALTH_PORT = Number(env("HEALTH_PORT", "8788"));
const account = privateKeyToAccount(env("KEEPER_PRIVATE_KEY") as Hex);

const chain = chainFor(CHAIN_ID, RPC_URL);
const dep = getDeployment(CHAIN_ID);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { batch: true }) });
const walletClient = createWalletClient({ chain, account, transport: http(RPC_URL) });
const here = dirname(fileURLToPath(import.meta.url));
const log = (m: string) => console.log(`[keeper ${new Date().toISOString()}] ${m}`);

const keeper = new Keeper({
  publicClient,
  walletClient,
  vault: dep.SubscriptionVault,
  batchSize: BATCH_SIZE,
  logFile: join(here, "..", "logs", `keeper-${CHAIN_ID}.jsonl`),
  log,
});

let lastError: string | null = null;
let lastTickAt: number | null = null;
let timer: NodeJS.Timeout | null = null;
let stopping = false;

async function loop() {
  if (stopping) return;
  try {
    const r = await keeper.tick();
    lastTickAt = Date.now();
    lastError = null;
    if (r.due > 0) log(`tick: due=${r.due} charged=${r.charged} failed=${r.failed} lapsed=${r.lapsed} txs=${r.txs}`);
  } catch (e) {
    lastError = (e as Error).message.split("\n")[0];
    log(`tick error: ${lastError}`);
  }
  if (!stopping) timer = setTimeout(loop, TICK_SECONDS * 1000);
}

const server = createServer(async (req, res) => {
  if (req.url !== "/health") return void res.writeHead(404).end();
  try {
    const claimable = await publicClient.readContract({
      address: dep.SubscriptionVault,
      abi: subscriptionVaultAbi,
      functionName: "claimable",
      args: [account.address, dep.MockUSDC],
    });
    const body = {
      ok: lastError === null,
      chainId: CHAIN_ID,
      keeper: account.address,
      tickSeconds: TICK_SECONDS,
      lastTickAt,
      lastTick: keeper.lastTick && {
        due: keeper.lastTick.due,
        charged: keeper.lastTick.charged,
        failed: keeper.lastTick.failed,
        lapsed: keeper.lastTick.lapsed,
        txs: keeper.lastTick.txs,
        gasUsed: keeper.lastTick.gasUsed.toString(),
      },
      queueSize: keeper.lastQueueSize,
      claimable: claimable.toString(),
      claimableFormatted: formatUnits(claimable, 6),
      lastError,
    };
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }).end(JSON.stringify(body));
  } catch (e) {
    res.writeHead(500, { "access-control-allow-origin": "*" }).end(JSON.stringify({ ok: false, error: (e as Error).message }));
  }
});

server.listen(HEALTH_PORT, () => log(`health on :${HEALTH_PORT} · chain ${CHAIN_ID} · keeper ${account.address} · tick ${TICK_SECONDS}s`));
loop();

function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  log(`${sig} received, finishing current tick then exiting`);
  if (timer) clearTimeout(timer);
  const wait = setInterval(() => {
    if (!keeper.ticking) {
      clearInterval(wait);
      server.close(() => process.exit(0));
    }
  }, 100);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
