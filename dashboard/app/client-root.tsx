"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Wallet SDKs touch browser-only APIs (indexedDB, localStorage) at import time, so the whole
// wallet-aware tree renders client-side only.
const Inner = dynamic(
  async () => {
    const [{ Providers }, { Nav }] = await Promise.all([import("./providers"), import("@/components/Nav")]);
    return function Inner({ children }: { children: ReactNode }) {
      return (
        <Providers>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">{children}</main>
        </Providers>
      );
    };
  },
  { ssr: false, loading: () => <div className="p-8 text-sm text-stone-400">Loading Cashew…</div> },
);

export function ClientRoot({ children }: { children: ReactNode }) {
  return <Inner>{children}</Inner>;
}
