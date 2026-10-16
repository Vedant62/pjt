"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useDeployment } from "@/lib/cashew";

const LINKS = [
  ["/", "Overview"],
  ["/provider", "Provider"],
  ["/plans/1", "Plan"],
  ["/chat", "Chat"],
  ["/activity", "Activity"],
  ["/attacks", "Attacks"],
  ["/epochs", "Epochs"],
] as const;

export function Nav() {
  const path = usePathname();
  const { chainId, dep } = useDeployment();
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-cashew-600 text-sm text-white">₵</span>
          Cashew
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map(([href, label]) => {
            const active = href === "/" ? path === "/" : path.startsWith(href.replace(/\/1$/, ""));
            return (
              <Link key={href} href={href} className={`rounded-md px-2.5 py-1.5 ${active ? "bg-cashew-50 text-cashew-700" : "text-stone-600 hover:bg-stone-100"}`}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {!dep && <span className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">no deployment on chain {chainId}</span>}
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        </div>
      </div>
    </header>
  );
}
