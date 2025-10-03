// src/shared/shutdown.ts
import type { Server } from "http";

export interface ShutdownOpts { timeoutMs?: number }

export function enableGracefulShutdown(server: Server, opts: ShutdownOpts = {}) {
  const timeoutMs = Math.max(1000, opts.timeoutMs ?? 10_000);
  let closing = false;

  const onSignal = (sig: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    console.log(`[shutdown] ${sig} received; closing HTTP server…`);
    const t = setTimeout(() => {
      console.error("[shutdown] forced exit after timeout");
      process.exit(1);
    }, timeoutMs);

    server.close(err => {
      clearTimeout(t);
      if (err) {
        console.error("[shutdown] close error:", err);
        process.exit(1);
      }
      console.log("[shutdown] closed cleanly");
      process.exit(0);
    });
  };

  (["SIGINT", "SIGTERM"] as NodeJS.Signals[]).forEach(s =>
    process.on(s, onSignal)
  );

  process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
  process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
}