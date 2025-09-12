// backend/src/shims/morgan.ts
// Tiny no-op logger compatible with express middleware signature.
export type MorganFormat = "tiny" | string;
export default function morgan(_format?: MorganFormat) {
  return function (_req: any, _res: any, next: any) {
    // intentionally no-op
    next();
  };
}
