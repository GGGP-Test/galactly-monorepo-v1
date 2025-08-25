const beats = new Map<string, number>(); // email -> expiresAt
const WINDOW_MS = 30_000;

export function beat(email: string) {
  beats.set(email, Date.now() + WINDOW_MS);
}
export function countActive(): number {
  const now = Date.now();
  for (const [k, v] of beats) if (v < now) beats.delete(k);
  return beats.size;
}
export function displayedCount(real: number): number {
  const floor = Math.max(0, Number(process.env.FLOOR_MIN_ONLINE || "40"));
  const jitter = Math.floor(Math.random() * 5) - 2; // -2..+2
  return Math.max(floor, Math.round(real * 1.1) + jitter);
}
