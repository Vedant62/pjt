"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { GATEWAY_URL } from "./cashew";

type Session = { token: string; address: string; expiresAt: number };
const keyFor = (chainId: number, addr: string) => `cashew.jwt.${chainId}.${addr.toLowerCase()}`;

function load(k: string): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(k) ?? "null") as Session | null;
    return s && s.expiresAt > Date.now() + 30_000 ? s : null;
  } catch {
    return null;
  }
}

/** Sign-In With Ethereum against the gateway; the JWT is cached per wallet+chain in localStorage. */
export function useGatewaySession() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSession(address ? load(keyFor(chainId, address)) : null);
  }, [address, chainId]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const { nonce } = await (await fetch(`${GATEWAY_URL}/auth/nonce`)).json();
      const message = createSiweMessage({
        address,
        chainId,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        version: "1",
        statement: "Sign in to the Cashew Gateway to use AI Power Grid with your subscription.",
        issuedAt: new Date(),
      });
      const signature = await signMessageAsync({ message });
      const r = await fetch(`${GATEWAY_URL}/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
      const s = { token: j.token, address, expiresAt: j.expiresAt };
      localStorage.setItem(keyFor(chainId, address), JSON.stringify(s));
      setSession(s);
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }, [address, chainId, signMessageAsync]);

  const signOut = useCallback(() => {
    if (address) localStorage.removeItem(keyFor(chainId, address));
    setSession(null);
  }, [address, chainId]);

  return { session, signIn, signOut, error, busy };
}
