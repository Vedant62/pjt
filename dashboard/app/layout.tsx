import type { Metadata } from "next";
import "./globals.css";
import { ClientRoot } from "./client-root";

export const metadata: Metadata = {
  title: "Cashew — on-chain subscriptions",
  description: "Decentralized recurring payments, demonstrated on AI Power Grid access.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  );
}
