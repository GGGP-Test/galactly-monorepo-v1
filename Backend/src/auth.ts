// src/auth.ts
export type Session = {
  token: string;
  userId?: string;
  expiresAt: number;
};

/**
 * Minimal session issuer for API routes that import { issueSession } from "../auth".
 * No external deps; returns a signed-ish opaque token suitable for dev/staging.
 */
export async function issueSession(userId: string | undefined, ttlMs = 1000 * 60 * 60 * 24): Promise<Session> {
  const expiresAt = Date.now() + ttlMs;
  // Opaque, non-cryptographic token (replace with real signer in prod).
  const raw = `${userId ?? "anon"}:${expiresAt}:${Math.random().toString(36).slice(2)}`;
  const token = Buffer.from(raw).toString("base64url");
  return { token, userId, expiresAt };
}
