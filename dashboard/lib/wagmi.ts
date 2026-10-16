"use client";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, coinbaseWallet, walletConnectWallet, rabbyWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { baseSepolia, foundry, sepolia } from "wagmi/chains";
import { devWallets } from "./devWallet";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
const defaultChain = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN ?? 31337);
const enableDev = (process.env.NEXT_PUBLIC_ENABLE_DEV_WALLETS ?? "true") === "true";

const groups = [
  {
    groupName: "Browser wallets",
    wallets: [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet, ...(projectId ? [walletConnectWallet] : [])],
  },
  ...(enableDev ? [{ groupName: "Local anvil (public test keys)", wallets: devWallets }] : []),
];

const connectors = connectorsForWallets(groups, { appName: "Cashew", projectId: projectId || "cashew-local" });

// The first chain is the one shown before a wallet connects; explorer links always follow the connected chain.
const chains =
  defaultChain === 11155111
    ? ([sepolia, baseSepolia, foundry] as const)
    : defaultChain === 84532
      ? ([baseSepolia, sepolia, foundry] as const)
      : ([foundry, sepolia, baseSepolia] as const);

export const wagmiConfig = createConfig({
  connectors,
  chains,
  ssr: true,
  transports: {
    [foundry.id]: http("http://127.0.0.1:8545"),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || "https://sepolia.base.org"),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com"),
  },
  pollingInterval: 2_000,
});
