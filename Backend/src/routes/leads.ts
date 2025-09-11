import type { App } from "../index";
import fs from "fs";
import path from "path";

type Temperature = "hot" | "warm";
type WhyChip = { label: string; kind: "meta" | "platform" | "signal" | "context"; score: number; detail: string };
export type Lead = {
  id: number;
  host: string;
  platform: string;
  title: string;
  created: string;
  temperature: Temperature;
  why: WhyChip[];
};

const memory: { leads: Lead[]; nextId: number } = { leads: [], nextId: 1 };

// Seed from /etc/secrets/seeds.txt if present (safe/optional)
function trySeedFromFile() {
  if (memory.leads.length) return;
  const candidatePaths = [
    process.env.SEEDS_PATH,
    "/etc/secrets/seeds.txt",
    "/etc/secrets/seed.txt",
  ].filter(Boolean) as string[];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, "utf8");
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const host = line.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
          memory.leads.push({
            id: memory.nextId++,
            host,
            platform: "unknown",
            title: `Lead: ${host}`,
            created: new Date().toISOString(),
            temperature: "warm",
            why: [
              { label: "Domain quality", kind: "meta", score: 0.65, detail: `${host} (.com?)` },
              { label: "Platform fit", kind: "platform", score: 0.5, detail: "unknown" },
              { label: "Intent keywords", kind: "signal", score: 0.6, detail: "— no strong keywords" },
            ],
          });
        }
        break;
      }
    } catch {
      /* ignore */
    }
  }
}
trySeedFromFile();

// GET /api/v1/leads?temp=hot|warm (defaults to warm)
export function mountLeads(app: App) {
  app.get("/api/v1/leads", (req, res) => {
    const temp = (String(req.query.temp || "warm").toLowerCase() as Temperature) || "warm";
    const rows = memory.leads.filter((l) => l.temperature === temp);
    res.json({ ok: true, rows, count: rows.length });
  });

  // POST /api/v1/leads/ingest  { host, platform?, title?, temperature?, why?[] }
  app.post("/api/v1/leads/ingest", (req, res) => {
    const hostRaw = String(req.body.host || "").trim();
    if (!hostRaw) return res.status(400).json({ ok: false, error: "host required" });
    const host = hostRaw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

    const lead: Lead = {
      id: memory.nextId++,
      host,
      platform: String(req.body.platform || "unknown"),
      title: String(req.body.title || `Lead: ${host}`),
      created: new Date().toISOString(),
      temperature: (req.body.temperature === "hot" ? "hot" : "warm"),
      why: Array.isArray(req.body.why) ? req.body.why : [
        { label: "Domain quality", kind: "meta", score: 0.65, detail: `${host} (.com?)` },
      ],
    };

    memory.leads.unshift(lead);
    res.json({ ok: true, id: lead.id });
  });
}
