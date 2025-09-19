export function hostOf(u: string): string {
  try { return new URL(u).host || ""; } catch { return ""; }
}

export function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s,/#&+\-]/g, " ")
    .split(/[\s,/#&+\-]+/)
    .filter(Boolean);
}

export function wantsUS(region?: string) {
  const r = (region || "").toLowerCase();
  return r.includes("us");
}

export function wantsCA(region?: string) {
  const r = (region || "").toLowerCase();
  return r.includes("ca");
}