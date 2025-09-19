import { Request, Response } from "express";
import type { SupplierInput, ResponsePayload } from "../lib/types";
import { dedupeKeepBest } from "../lib/dedupe";
import { discoverCandidates } from "../lib/providers";

export default async function findBuyers(
  req: Request<unknown, unknown, SupplierInput>,
  res: Response
) {
  const body = req.body ?? {};

  const supplier =
    (typeof body.supplier === "string" && body.supplier.trim()) || undefined;
  const region =
    typeof body.region === "string" && body.region.trim()
      ? body.region.toLowerCase()
      : undefined;
  const radiusMi =
    typeof body.radiusMi === "number"
      ? body.radiusMi
      : body.radiusMi != null
      ? Number(body.radiusMi)
      : undefined;

  const { created, candidates, note } = await discoverCandidates({
    supplier,
    region,
    radiusMi,
    persona: body.persona,
  });

  const finalCands = dedupeKeepBest(candidates)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  const payload: ResponsePayload = {
    created,
    candidates: finalCands,
    inferred: { supplier, region, radiusMi },
    note,
  };

  res.status(200).json(payload);
}