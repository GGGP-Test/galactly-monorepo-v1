// Backend/src/store.ts
// Tiny JSON persistence for leads (+ notes/stage). File survives restarts if you mount a volume.
// Safe to use without a volume (data will reset on redeploys).

import fs from "node:fs/promises";
import path from "node:path";

export type WhyChip = {
  label: string;          // e.g. "New product (3d ago)"
  kind: "intent" | "context" | "platform" | "meta";
  score?: number;         // 0..1 optional
  detail?: string;        // freeform text
};

export type Lead = {
  id: number;
  host: string;           // domain
  platform: string;       // shopify/bigcommerce/unknown
  title: string;          // UI title
  created: string;        // ISO timestamp
  temperature: "hot" | "warm";
  why: WhyChip[];
  keywords?: string;      // comma separated hint
  stage?: "new" | "researching" | "contacted" | "won" | "lost";
  notes?: { ts: string; text: string }[];
};

type DB = {
  seq: number;
  leads: Lead[];
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "leads.json");

async function ensureFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    const empty: DB = { seq: 0, leads: [] };
    await fs.writeFile(DATA_FILE, JSON.stringify(empty, null, 2), "utf8");
  }
}

async function readDB(): Promise<DB> {
  await ensureFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw) as DB;
    if (!parsed || !Array.isArray(parsed.leads)) throw new Error("bad file");
    return parsed;
  } catch {
    const fallback: DB = { seq: 0, leads: [] };
    await fs.writeFile(DATA_FILE, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function writeDB(db: DB): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

export async function allLeads(): Promise<Lead[]> {
  const db = await readDB();
  // newest first
  return db.leads.slice().sort((a, b) => (a.id < b.id ? 1 : -1));
}

export async function addLeads(newOnes: Omit<Lead, "id" | "created">[]): Promise<Lead[]> {
  const db = await readDB();
  const seen = new Set(db.leads.map(l => l.host));
  const createdAt = new Date().toISOString();

  const inserted: Lead[] = [];
  for (const n of newOnes) {
    if (seen.has(n.host)) continue;
    const lead: Lead = {
      ...n,
      id: ++db.seq,
      created: createdAt,
      notes: [],
      stage: n.stage ?? "new",
    };
    db.leads.push(lead);
    inserted.push(lead);
    seen.add(n.host);
  }
  await writeDB(db);
  return inserted;
}

export async function updateStage(id: number, stage: Lead["stage"]): Promise<Lead | undefined> {
  const db = await readDB();
  const idx = db.leads.findIndex(l => l.id === id);
  if (idx === -1) return undefined;
  db.leads[idx].stage = stage;
  await writeDB(db);
  return db.leads[idx];
}

export async function appendNote(id: number, text: string): Promise<Lead | undefined> {
  const db = await readDB();
  const idx = db.leads.findIndex(l => l.id === id);
  if (idx === -1) return undefined;
  db.leads[idx].notes ??= [];
  db.leads[idx].notes!.push({ ts: new Date().toISOString(), text });
  await writeDB(db);
  return db.leads[idx];
}

export async function clearAll(): Promise<void> {
  await writeDB({ seq: 0, leads: [] });
}
