import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getAddress, type Address, type Hex } from "viem";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import type { DB } from "./db";
import type { ChainCtx } from "./chain";
import type { GatewayConfig } from "./config";

const NONCE_TTL_MS = 10 * 60_000;
const JWT_TTL = "1h";

export interface AuthedRequest extends Request {
  wallet?: Address;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function makeAuth(cfg: GatewayConfig, db: DB, ctx: ChainCtx) {
  const nonces = new Map<string, number>();

  function issueNonce() {
    const now = Date.now();
    for (const [n, exp] of nonces) if (exp < now) nonces.delete(n);
    const nonce = generateSiweNonce();
    nonces.set(nonce, now + NONCE_TTL_MS);
    return nonce;
  }

  /** EIP-4361: verify domain, nonce (single use), chain, expiry and signature. */
  async function verify(message: string, signature: Hex): Promise<{ token: string; address: Address; expiresAt: number }> {
    const parsed = parseSiweMessage(message);
    if (!parsed.address || !parsed.nonce) throw new Error("malformed SIWE message");
    const exp = nonces.get(parsed.nonce);
    if (!exp || exp < Date.now()) throw new Error("unknown or expired nonce");
    const domains = cfg.siweDomain.split(",").map((d) => d.trim());
    if (!parsed.domain || !domains.includes(parsed.domain)) throw new Error(`domain mismatch: expected one of ${domains.join(", ")}`);
    if (parsed.chainId !== cfg.chainId) throw new Error(`chainId mismatch: expected ${cfg.chainId}`);
    const ok = await ctx.publicClient.verifySiweMessage({
      message,
      signature,
      domain: parsed.domain,
      nonce: parsed.nonce,
    });
    if (!ok) throw new Error("invalid SIWE signature");
    nonces.delete(parsed.nonce);
    const address = getAddress(parsed.address);
    const expiresAt = Date.now() + 3600_000;
    const token = jwt.sign({ sub: address }, cfg.jwtSecret, { expiresIn: JWT_TTL, audience: "cashew-gateway" });
    return { token, address, expiresAt };
  }

  function issueApiKey(wallet: Address) {
    const key = `csk_${randomBytes(24).toString("hex")}`;
    db.insertKey(sha256(key), wallet, key.slice(0, 10));
    return key;
  }

  function resolveBearer(header: string | undefined): Address | null {
    if (!header?.startsWith("Bearer ")) return null;
    const tok = header.slice(7).trim();
    if (tok.startsWith("csk_")) {
      const row = db.keyByHash(sha256(tok));
      return row ? getAddress(row.wallet) : null;
    }
    try {
      const p = jwt.verify(tok, cfg.jwtSecret, { audience: "cashew-gateway" }) as { sub: string };
      return getAddress(p.sub);
    } catch {
      return null;
    }
  }

  /** Accepts a SIWE JWT or a `csk_…` API key. */
  function requireWallet(req: AuthedRequest, res: Response, next: NextFunction) {
    const wallet = resolveBearer(req.headers.authorization);
    if (!wallet)
      return res.status(401).json({ error: { type: "unauthorized", message: "Bearer SIWE JWT or csk_ API key required" } });
    req.wallet = wallet;
    next();
  }

  /** JWT only (used to mint API keys, so a leaked key cannot mint more keys). */
  function requireJwt(req: AuthedRequest, res: Response, next: NextFunction) {
    const h = req.headers.authorization;
    if (h?.startsWith("Bearer csk_")) return res.status(401).json({ error: { type: "unauthorized", message: "SIWE JWT required" } });
    return requireWallet(req, res, next);
  }

  return { issueNonce, verify, issueApiKey, requireWallet, requireJwt };
}
