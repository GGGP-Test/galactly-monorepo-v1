// src/shared/csv.ts
//
// CSV helpers for Admin exports (no deps).
// Usage:
//   import { leadsToCsv, eventsToCsv, sendCsv } from "./csv";
//   const csv = leadsToCsv(items); sendCsv(res, "leads.csv", csv);

/* eslint-disable @typescript-eslint/no-explicit-any */

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Escape quotes and wrap in quotes if needed
  const needs = /[",\n\r]/.test(s) || /^\s|\s$/.test(s);
  const body = s.replace(/"/g, '""');
  return needs ? `"${body}"` : body;
}

function joinRow(cols: unknown[]): string {
  return cols.map(esc).join(",");
}

export function sendCsv(res: any, filename: string, csv: string): void {
  try {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  } catch { /* ignore for tests */ }
  res.end(csv);
}

export type LeadLike = {
  host: string;
  name?: string;
  city?: string;
  url?: string;
  tier?: "A" | "B" | "C";
  score?: number;
  band?: "HOT" | "WARM" | "COOL";
  uncertainty?: number;
  provider?: string;
  tags?: string[];
  reasons?: string[];
  [k: string]: any;
};

export function leadsToCsv(items: LeadLike[], opts?: { filename?: string }): string {
  const header = [
    "host","name","city","url",
    "tier","score","band","uncertainty",
    "provider","tags","reasons","at"
  ];
  const rows: string[] = [joinRow(header)];

  const now = new Date().toISOString();
  for (const it of (items || [])) {
    rows.push(joinRow([
      it.host || "",
      it.name || "",
      it.city || "",
      it.url || (`https://${(it.host || "").replace(/^www\./,"")}`),
      it.tier || "",
      Number.isFinite(it.score) ? (it.score as number) : "",
      it.band || "",
      Number.isFinite(it.uncertainty) ? (it.uncertainty as number) : "",
      it.provider || "",
      Array.isArray(it.tags) ? it.tags.slice(0, 24).join(";") : "",
      Array.isArray(it.reasons) ? it.reasons.slice(0, 24).join(";") : "",
      it.fetchedAt || it.at || now
    ]));
  }
  return rows.join("\r\n");
}

export type EventLike = {
  at?: string;
  kind?: string;
  data?: any;
};

export function eventsToCsv(events: EventLike[]): string {
  const header = ["at","kind","host","user","city","band","score","detail"];
  const rows: string[] = [joinRow(header)];

  for (const e of (events || [])) {
    const d = e?.data || {};
    rows.push(joinRow([
      e.at || new Date().toISOString(),
      e.kind || "",
      d.host || "",
      d.user || d.email || "",
      d.city || "",
      d.bandApplied || d.band || "",
      Number.isFinite(d.score) ? d.score : "",
      JSON.stringify(d).slice(0, 2000) // keep row bounded
    ]));
  }
  return rows.join("\r\n");
}

// convenience: create a filename with date
export function datedFilename(stem: string, ext = "csv"): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stem}-${iso}.${ext}`;
}

export default { leadsToCsv, eventsToCsv, sendCsv, datedFilename };