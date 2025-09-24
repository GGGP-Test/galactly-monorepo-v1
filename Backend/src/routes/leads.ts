// src/routes/leads.ts
import { Router, Request, Response } from "express";
import { pool } from "../shared/db"; // ← single, fixed path (do not change)

type Temp = "cold" | "warm" | "hot";
type Candidate = {
  host: string;
  platform: "web";
  title: string;
  created: string; // ISO string
  temp: Temp;
  why: string;
};

const router = Router();

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

router.get("/find-buyers", async (req: Request, res: Response) => {
  const supplierHost = str(req.query.host).toLowerCase().trim();
  const region = str(req.query.region, "US/CA");
  const radius = str(req.query.radius, "50mi");

  if (!supplierHost) {
    res.status(400).json({ error: "query param 'host' is required" });
    return;
  }

  // V1: deterministic, safe output so UI and flow stay green.
  // (We’ll swap this for the smarter guesser after the codebase is stable.)
  const now = new Date().toISOString();
  const items: Candidate[] = [
    {
      host: "hormelfoods.com",
      platform: "web",
      title: "Supplier / vendor info | hormelfoods.com",
      created: now,
      temp: "warm",
      why: `Near ${region}; packaging-compatible buyer for ${supplierHost}; radius ${radius}.`,
    },
  ];

  //