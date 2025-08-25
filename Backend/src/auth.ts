import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

const SECRET = (process.env.JWT_SECRET || "dev-secret").trim();
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function hmac(s: string) {
  return crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
}
export function issueSession(email: string): string {
  const now = Date.now();
  const data = `${email}|${now}`;
  const sig = hmac(data);
  return Buffer.from(data).toString("base64url") + "." + sig;
}
export function verifySession(tok: string): string | null {
  try {
    const [b64, sig] = tok.split(".");
    const data = Buffer.from(b64, "base64url").toString("utf8");
    if (hmac(data) !== sig) return null;
    const [email, ts] = data.split("|");
    if (!email || !ts) return null;
    if (Date.now() - Number(ts) > TTL_MS) return null;
    return email;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  const email = tok ? verifySession(tok) : null;
  if (!email) return res.status(401).json({ ok: false, error: "auth" });
  (req as any).userEmail = email;
  next();
}
