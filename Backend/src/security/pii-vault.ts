// src/security/pii-vault.ts
// -----------------------------------------------------------------------------
// pii-vault.ts — tokenization, encryption, and access checks for PII
//
// Goals:
//  - Keep raw emails/phones encrypted at rest (AES-256-GCM).
//  - Deterministic tokens for joins across systems without revealing PII (HMAC).
//  - Role/tenant scoped access checks + audit trail hooks.
//  - Redaction utilities for logs/exports.
//
// This file is Node-only and uses Buffer everywhere (no ArrayBuffer in types).
// It also avoids default imports to play nice with tsconfig settings.
// -----------------------------------------------------------------------------

import * as crypto from 'node:crypto';

// ---------------------------- Types ------------------------------

export type PIIKind = 'email' | 'phone' | 'name';

export interface VaultRecord {
  tenantId: string;
  kind: PIIKind;
  token: string;      // deterministic token (HMAC)
  ciphertext: string; // base64
  iv: string;         // base64
  tag: string;        // base64 (GCM auth tag)
  createdAt: string;
}

export interface AccessContext {
  tenantId: string;
  role: 'system' | 'admin' | 'analyst' | 'worker';
  purpose: 'enrichment' | 'delivery' | 'support' | 'export' | 'debug';
  actorId?: string;
}

export interface KeyManager {
  getDataKey(tenantId: string): Promise<Buffer>; // 32 bytes
}

export interface VaultStore {
  put(rec: VaultRecord): Promise<void>;
  getByToken(tenantId: string, token: string): Promise<VaultRecord | null>;
  purgeByTenant(tenantId: string): Promise<number>;
}

// ---------------------- Default implementations ------------------

/**
 * LocalKeyManager — dev-only symmetric master key (from env).
 * For prod use a KMS (AWS KMS, GCP KMS, Azure KeyVault) to derive per-tenant DEKs.
 */
export class LocalKeyManager implements KeyManager {
  constructor(
    private masterKey: string = process.env.PII_MASTER_KEY || 'dev-only-master-key-please-override'
  ) {}
  async getDataKey(tenantId: string): Promise<Buffer> {
    // HKDF(master, salt=tenantId, info="pii-vault", len=32)
    const salt = Buffer.from(tenantId, 'utf8');
    return hkdf(this.masterKey, salt, 'pii-vault', 32);
  }
}

/**
 * InMemoryVaultStore — dev-only store. Replace with a DB adapter.
 */
export class InMemoryVaultStore implements VaultStore {
  private map = new Map<string, VaultRecord>();
  async put(rec: VaultRecord): Promise<void> {
    this.map.set(`${rec.tenantId}:${rec.token}`, rec);
  }
  async getByToken(tenantId: string, token: string): Promise<VaultRecord | null> {
    return this.map.get(`${tenantId}:${token}`) || null;
  }
  async purgeByTenant(tenantId: string): Promise<number> {
    let count = 0;
    for (const k of Array.from(this.map.keys())) {
      if (k.startsWith(`${tenantId}:`)) {
        this.map.delete(k);
        count++;
      }
    }
    return count;
  }
}

// ------------------------------ Vault ----------------------------

export class PIIVault {
  private pepper: Buffer;

  constructor(
    private store: VaultStore,
    private keys: KeyManager,
    pepperEnv: string | undefined = process.env.PII_TOKEN_PEPPER
  ) {
    const p = pepperEnv || 'dev-only-token-pepper-override';
    this.pepper = Buffer.isBuffer(p as any) ? (p as any) : Buffer.from(p, 'utf8');
  }

  /**
   * Deterministically tokenizes a value for join/search without revealing PII.
   * Uses HMAC-SHA256 of normalized value with tenantId + pepper.
   */
  tokenize(kind: PIIKind, value: string, tenantId: string): string {
    const norm = normalize(kind, value);
    const mac = crypto.createHmac(
      'sha256',
      Buffer.concat([this.pepper, Buffer.from(tenantId, 'utf8')])
    );
    mac.update(kind);
    mac.update('|');
    mac.update(norm);
    // URL-safe compact token
    return mac.digest('base64url');
  }

  /**
   * Encrypt and store the raw PII under deterministic token.
   */
  async vaultPut(
    ctx: AccessContext,
    kind: PIIKind,
    value: string
  ): Promise<{ token: string }> {
    requireAccess(ctx, ['system', 'admin', 'worker'], ['enrichment', 'delivery', 'support']);
    const tenantId = ctx.tenantId;
    const token = this.tokenize(kind, value, tenantId);
    const dek = await this.keys.getDataKey(tenantId);
    const { ciphertext, iv, tag } = aesGcmEncrypt(dek, Buffer.from(value, 'utf8'));
    const rec: VaultRecord = {
      tenantId,
      kind,
      token,
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      createdAt: new Date().toISOString(),
    };
    await this.store.put(rec);
    // optional: emitAudit("vault.put", ctx, { kind, token });
    return { token };
  }

  /**
   * Fetch and decrypt PII for allowed roles/purposes.
   */
  async vaultGet(ctx: AccessContext, token: string): Promise<string | null> {
    requireAccess(ctx, ['system', 'admin'], ['delivery', 'support', 'export']);
    const rec = await this.store.getByToken(ctx.tenantId, token);
    if (!rec) return null;
    const dek = await this.keys.getDataKey(ctx.tenantId);
    const plain = aesGcmDecrypt(
      dek,
      Buffer.from(rec.ciphertext, 'base64'),
      Buffer.from(rec.iv, 'base64'),
      Buffer.from(rec.tag, 'base64')
    );
    return plain.toString('utf8');
  }

  /**
   * Pseudonymous lookup: expose token only (no decryption).
   */
  async getTokenOnly(ctx: AccessContext, token: string): Promise<string | null> {
    requireAccess(ctx, ['system', 'admin', 'analyst', 'worker'], ['debug', 'support', 'enrichment']);
    const rec = await this.store.getByToken(ctx.tenantId, token);
    return rec ? rec.token : null;
  }

  /**
   * Purge all PII for a tenant (account deletion / data subject request).
   */
  async purgeTenant(ctx: AccessContext): Promise<number> {
    requireAccess(ctx, ['system', 'admin'], ['support', 'export']);
    return this.store.purgeByTenant(ctx.tenantId);
  }

  /**
   * Convenience: redact values for logs/preview.
   */
  static redact(kind: PIIKind, value?: string | null): string {
    if (!value) return '';
    if (kind === 'email') {
      const [u, d] = value.split('@');
      return `${redactMid(u)}@${redactMid(d)}`;
    }
    if (kind === 'phone') {
      const digits = value.replace(/\D/g, '');
      if (digits.length >= 10) return `+1 ***-***-${digits.slice(-4)}`;
      return '***-***-****';
    }
    return redactMid(value);
  }
}

// ------------------------------ helpers --------------------------

function normalize(kind: PIIKind, value: string): string {
  if (kind === 'email') return value.trim().toLowerCase();
  if (kind === 'phone') {
    const d = value.replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('1')) return d.slice(1);
    return d;
  }
  return value.trim();
}

function hkdf(secret: string, salt: Buffer, info: string, len: number): Buffer {
  return crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), salt, Buffer.from(info, 'utf8'), len);
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ct, iv, tag };
}

function aesGcmDecrypt(key: Buffer, ciphertext: Buffer, iv: Buffer, tag: Buffer) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function requireAccess(
  ctx: AccessContext,
  roles: AccessContext['role'][],
  purposes: AccessContext['purpose'][]
) {
  if (!roles.includes(ctx.role) || !purposes.includes(ctx.purpose)) {
    const msg = `PII access denied for role=${ctx.role} purpose=${ctx.purpose}`;
    // optional: emitAudit("vault.denied", ctx, { msg });
    throw new Error(msg);
  }
}

function redactMid(s: string): string {
  if (!s) return '';
  if (s.length <= 4) return '*'.repeat(s.length);
  const keep = Math.max(1, Math.floor(s.length * 0.2));
  return s.slice(0, keep) + '*'.repeat(s.length - 2 * keep) + s.slice(-keep);
}

// ----------------------------- examples --------------------------
// Example wiring (dev):
//
// const store = new InMemoryVaultStore();
// const keys  = new LocalKeyManager(process.env.PII_MASTER_KEY);
// const vault = new PIIVault(store, keys, process.env.PII_TOKEN_PEPPER);
//
// const ctx: AccessContext = { tenantId: "t_abc", role: "worker", purpose: "enrichment" };
// const { token } = await vault.vaultPut(ctx, "email", "ops@buyer.com");
// // store token on lead.contact.emailToken ; no raw email in your DB tables.
// const raw = await vault.vaultGet({ tenantId: "t_abc", role: "admin", purpose: "delivery" }, token);
