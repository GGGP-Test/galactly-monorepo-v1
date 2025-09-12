// Avoid type/runtime issues if stripe isn’t installed.
type StripeCtor = any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Stripe: StripeCtor = (() => { try { return require('stripe'); } catch { return null; } })();

export function maybeCreateStripe(apiKey?: string): any | null {
  if (!Stripe || !apiKey) return null;
  return new Stripe(apiKey);
}
