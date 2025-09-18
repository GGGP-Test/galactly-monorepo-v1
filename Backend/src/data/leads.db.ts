// Backend/src/data/leads.db.ts
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// keep DB in a writable, persistent folder
const DATA_DIR = process.env.DATA_DIR || "/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const dbPath = path.join(DATA_DIR, "leads.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  host TEXT,
  title TEXT,
  created TEXT,
  temp TEXT,
  why TEXT
);
`);

export type LeadRow = {
  id: string; host: string; title: string; created: string; temp: "hot"|"warm"; why?: any;
};

const insert = db.prepare(
  `INSERT OR REPLACE INTO leads (id,host,title,created,temp,why) VALUES (?,?,?,?,?,?)`
);
const selectByTemp = db.prepare(
  `SELECT id,host,title,created,temp,why FROM leads WHERE temp = ? ORDER BY datetime(created) DESC LIMIT 300`
);

export function saveLeads(rows: LeadRow[]) {
  const tx = db.transaction((items: LeadRow[]) => {
    for (const r of items) insert.run(r.id, r.host, r.title, r.created, r.temp, JSON.stringify(r.why ?? null));
  });
  tx(rows);
}

export function listLeads(temp: "hot"|"warm"): LeadRow[] {
  return selectByTemp.all(temp).map((r: any) => ({ ...r, why: r.why ? JSON.parse(r.why) : undefined }));
}