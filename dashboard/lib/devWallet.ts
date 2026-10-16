"use client";
import { createWalletClient, http, numberToHex, hexToBigInt, type Hex, type EIP1193Provider } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { injected } from "wagmi/connectors";
import type { Wallet } from "@rainbow-me/rainbowkit";
import { ANVIL_ACCOUNTS } from "@cashew/shared";

/**
 * Anvil-only burner wallets built from the PUBLIC anvil test keys. They let the local demo run
 * without a browser extension. They only ever talk to chain 31337 at 127.0.0.1:8545.
 */
function makeProvider(id: string, key: Hex): EIP1193Provider {
  const flag = `cashew.devwallet.${id}`;
  const authorized = () => {
    try {
      return localStorage.getItem(flag) === "1";
    } catch {
      return false;
    }
  };
  const setAuthorized = (v: boolean) => {
    try {
      v ? localStorage.setItem(flag, "1") : localStorage.removeItem(flag);
    } catch {}
  };
  const account = privateKeyToAccount(key);
  const client = createWalletClient({ account, chain: foundry, transport: http("http://127.0.0.1:8545") });
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      const p = (params ?? []) as any[];
      switch (method) {
        case "eth_requestAccounts":
          setAuthorized(true);
          return [account.address];
        case "eth_accounts":
          // Only report the account after an explicit connect, so dev wallets don't auto-connect.
          return authorized() ? [account.address] : [];
        case "wallet_revokePermissions":
          setAuthorized(false);
          return null;
        case "eth_chainId":
          return numberToHex(foundry.id);
        case "net_version":
          return String(foundry.id);
        case "wallet_switchEthereumChain":
          if (Number(p[0]?.chainId) !== foundry.id) throw Object.assign(new Error("Dev wallet only supports anvil (31337)"), { code: 4902 });
          return null;
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "personal_sign":
          return account.signMessage({ message: { raw: p[0] as Hex } });
        case "eth_signTypedData_v4": {
          const data = typeof p[1] === "string" ? JSON.parse(p[1]) : p[1];
          const { EIP712Domain: _d, ...types } = data.types;
          return account.signTypedData({ domain: data.domain, types, primaryType: data.primaryType, message: data.message });
        }
        case "eth_sendTransaction": {
          const tx = p[0];
          return client.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? hexToBigInt(tx.value) : undefined,
            gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
          } as any);
        }
        default:
          return client.request({ method, params } as any);
      }
    },
    on(ev: string, fn: (...a: unknown[]) => void) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
    },
    removeListener(ev: string, fn: (...a: unknown[]) => void) {
      listeners.get(ev)?.delete(fn);
    },
  };
  return provider as unknown as EIP1193Provider;
}

const DEV: { id: string; label: string; key: Hex }[] = [
  { id: "dev-provider", label: "Anvil #0 · provider", key: ANVIL_ACCOUNTS.deployer.key },
  { id: "dev-subscriber", label: "Anvil #3 · subscriber", key: ANVIL_ACCOUNTS.subscriber1.key },
  { id: "dev-subscriber2", label: "Anvil #4 · subscriber 2", key: ANVIL_ACCOUNTS.subscriber2.key },
  { id: "dev-attacker", label: "Anvil #5 · attacker", key: ANVIL_ACCOUNTS.attacker.key },
];

const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="#b86422"/><text x="14" y="19" font-size="13" text-anchor="middle" fill="white" font-family="monospace">dev</text></svg>',
  );

export const devWallets: (() => Wallet)[] = DEV.map((d) => () => ({
  id: d.id,
  name: d.label,
  iconUrl: ICON,
  iconBackground: "#b86422",
  installed: true,
  createConnector: (walletDetails) => (config) => ({
    ...injected({ target: { id: d.id, name: d.label, provider: makeProvider(d.id, d.key) as any } })(config),
    ...walletDetails,
  }),
}));
