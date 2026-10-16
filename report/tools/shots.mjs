// Dashboard + explorer screenshots for the report (1440×900, Chrome via playwright-core).
// Test wallets are injected as an EIP-1193 provider whose signing happens in this Node process
// (keys are read from the gitignored .env files and never reach the page).
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, hexToBigInt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ROOT = new URL("../../", import.meta.url).pathname;
const OUT = ROOT + "report/shots/";
const APP = process.env.APP ?? "http://localhost:3001";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const envOf = (f) => Object.fromEntries(readFileSync(ROOT + f, "utf8").split("\n").map((l) => l.match(/^([A-Z0-9_]+)=(\S+)/)).filter(Boolean).map((m) => [m[1], m[2]]));
const KEYS = {
  deployer: envOf("contracts/.env").PRIVATE_KEY,
  subscriber: envOf("sim/.env").LIFECYCLE_SUBSCRIBER_KEY,
  outsider: envOf("gateway/.env").GATEWAY_PRIVATE_KEY, // no subscription, no claimable balance
};
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);

const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: !process.env.HEADED });

async function page(role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  if (role) {
    const account = privateKeyToAccount(KEYS[role]);
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
    await ctx.exposeBinding("__cashewRpc", async (_src, method, params = []) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "eth_chainId":
          return "0xaa36a7";
        case "wallet_switchEthereumChain":
        case "wallet_requestPermissions":
        case "wallet_revokePermissions":
          return null;
        case "personal_sign":
          return account.signMessage({ message: { raw: params[0] } });
        case "eth_signTypedData_v4": {
          const d = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
          const { EIP712Domain, ...types } = d.types;
          return account.signTypedData({ domain: d.domain, types, primaryType: d.primaryType, message: d.message });
        }
        case "eth_sendTransaction": {
          const t = params[0];
          return wallet.sendTransaction({ to: t.to, data: t.data, value: t.value ? hexToBigInt(t.value) : undefined, gas: t.gas ? hexToBigInt(t.gas) : undefined });
        }
        default:
          return pub.request({ method, params });
      }
    });
    await ctx.addInitScript(() => {
      const listeners = {};
      const provider = {
        isCashewTest: true,
        request: ({ method, params }) => window.__cashewRpc(method, params),
        on: (e, f) => ((listeners[e] ??= []).push(f), provider),
        removeListener: () => provider,
      };
      window.ethereum = provider;
      const info = { uuid: "6a1c9e1e-0000-4000-8000-cashewtest01", name: "Cashew Test Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><rect width='8' height='8' fill='%23b86422'/></svg>", rdns: "dev.cashew.test" };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });
  }
  const p = await ctx.newPage();
  return p;
}

async function open(p, path) {
  await p.goto(APP + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
}
async function connect(p) {
  const btn = p.getByRole("button", { name: "Connect Wallet" });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await p.getByText("Cashew Test Wallet").first().click();
  }
  await p.waitForTimeout(3000);
}
const shot = async (p, name, full = false) => {
  await p.screenshot({ path: OUT + name + ".png", fullPage: full });
  console.log("shot", name);
};

if (want("overview")) {
  const p = await page(null);
  await open(p, "/");
  await p.waitForSelector("text=healthy", { timeout: 20000 });
  await p.waitForTimeout(4000);
  await shot(p, "01-overview", true);
}
if (want("provider")) {
  const p = await page("deployer");
  await open(p, "/provider");
  await connect(p);
  await p.waitForTimeout(5000);
  await shot(p, "02-provider", true);
}
if (want("plan")) {
  const p = await page("subscriber");
  await open(p, "/plans/1");
  await connect(p);
  await p.waitForSelector("text=Sub id", { timeout: 30000 });
  await p.waitForTimeout(3000);
  await shot(p, "03-plan");
}
if (want("chat")) {
  const p = await page("subscriber");
  await open(p, "/chat");
  await connect(p);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForSelector('input[placeholder="Message qwen…"]', { timeout: 30000 });
  await p.fill('input[placeholder="Message qwen…"]', "In two sentences, what does a subscription keeper do? /no_think");
  await p.keyboard.press("Enter");
  await p.waitForSelector("text=/completion tokens/", { timeout: 120000 });
  await p.waitForSelector("text=Send", { timeout: 120000 });
  await p.waitForTimeout(1500);
  await shot(p, "04-chat");
}
if (want("chat402")) {
  const p = await page("outsider");
  await open(p, "/chat");
  await connect(p);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForSelector('input[placeholder="Message qwen…"]', { timeout: 30000 });
  await p.fill('input[placeholder="Message qwen…"]', "Hello grid");
  await p.keyboard.press("Enter");
  await p.waitForSelector("text=402 Payment Required", { timeout: 30000 });
  await p.waitForTimeout(1000);
  await shot(p, "05-chat-402");
}
if (want("activity")) {
  const p = await page(null);
  await open(p, "/activity");
  await p.waitForSelector("text=Charged", { timeout: 60000 });
  await p.waitForTimeout(6000);
  await shot(p, "06-activity");
}
if (want("attacks")) {
  const p = await page("outsider");
  await open(p, "/attacks");
  await connect(p);
  await p.waitForTimeout(4000);
  for (const b of await p.getByRole("button", { name: "Run attack" }).all()) {
    await b.click();
    await p.waitForTimeout(3000);
  }
  await p.waitForFunction(() => document.querySelectorAll("div.font-semibold.text-emerald-800").length >= 5, null, { timeout: 60000 }).catch(async () => { await shot(p, "debug-attacks", true); console.log(await p.locator("main").innerText()); });
  await p.waitForTimeout(1000);
  await shot(p, "07-attacks", true);
}
if (want("epochs")) {
  const p = await page(null);
  await open(p, "/epochs");
  await p.waitForSelector('input[type="radio"]', { timeout: 30000 });
  await p.locator('input[type="radio"]').first().click();
  await p.getByRole("button", { name: /Fetch proof/ }).click();
  await p.waitForSelector("text=Row is included", { timeout: 60000 });
  await shot(p, "08-epochs-verified", true);
  await p.getByText("Tamper (+1 completion token)").click();
  await p.getByRole("button", { name: /Fetch proof/ }).click();
  await p.waitForSelector("text=Tampered row rejected", { timeout: 60000 });
  await shot(p, "09-epochs-tampered", true);
}
if (want("etherscan")) {
  const dep = JSON.parse(readFileSync(ROOT + "contracts/deployments/11155111.json", "utf8"));
  const lc = JSON.parse(readFileSync(ROOT + "results/lifecycle_testnet.json", "utf8"));
  const charge = lc.steps.find((s) => s.step === "keeper charge");
  for (const [name, url] of [
    ["10-etherscan-vault", `https://sepolia.etherscan.io/address/${dep.SubscriptionVault}#code`],
    ["11-etherscan-charge", `https://sepolia.etherscan.io/tx/${charge.txHash}`],
  ]) {
    const p = await page(null);
    await p.goto(url, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(6000);
    await shot(p, name);
  }
}
await browser.close();
