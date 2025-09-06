/**
 * src/ops/cron.ts
 *
 * Single entry to run pipeline jobs from CLI or programmatically.
 *
 * Usage:
 *   pnpm ts-node src/ops/cron.ts --job discover --limit 200 --concurrency 8 --tenant TENANT_123
 *   pnpm ts-node src/ops/cron.ts --job crawl
 *   pnpm ts-node src/ops/cron.ts --job score
 *   pnpm ts-node src/ops/cron.ts --job route
 *   pnpm ts-node src/ops/cron.ts --job notify
 */

import { promises as fs } from "fs";
import * as path from "path";

type JobName = "discover" | "crawl" | "score" | "route" | "notify";

interface RunOpts {
  job: string;
  limit?: number;
  concurrency?: number;
  tenantId?: string;
}

function parseArgs(argv = process.argv.slice(2)): RunOpts {
  const opts: any = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) {
      const key = a.replace(/^--?/, "");
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    }
  }
  opts.limit = Number(opts.limit || 100);
  opts.concurrency = Number(opts.concurrency || 5);
  return opts as RunOpts;
}

// Dynamically import helpers if present; otherwise provide file-backed fallbacks.
async function tryImport<T = any>(modulePathTs: string, modulePathJs: string): Promise<T | null> {
  try {
    const mod = (await import(modulePathTs)) as T;
    return mod;
  } catch {
    try {
      const mod = (await import(modulePathJs)) as T;
      return mod;
    } catch {
      return null;
    }
  }
}

const FILE_QUEUE = path.resolve(process.cwd(), "data/lead-source-queue.ndjson");

async function runDiscover(limit: number, tenantId?: string) {
  // Prefer project discoverer if present
  const discoverer = await tryImport<any>(
    path.resolve(process.cwd(), "src/discovery.ts"),
    path.resolve(process.cwd(), "src/discovery.js")
  );
  if (discoverer?.runDiscover) {
    return discoverer.runDiscover({ limit, tenantId });
  }
  // Fallback: peek into file queue and print which domains would be scheduled
  try {
    const data = await fs.readFile(FILE_QUEUE, "utf8");
    const lines = data.trim().split("\n").slice(-limit);
    const items = lines.map((l) => JSON.parse(l));
    return {
      adapter: "file",
      scheduled: Math.min(items.length, limit),
      domains: items.slice(0, limit).map((x: any) => x.domain),
    };
  } catch {
    return { adapter: "none", scheduled: 0, note: "no queue found" };
  }
}

async function runCrawl(limit: number, concurrency: number, tenantId?: string) {
  const crawler = await tryImport<any>(
    path.resolve(process.cwd(), "src/crawl-scheduler.ts"),
    path.resolve(process.cwd(), "src/crawl-scheduler.js")
  );
  if (crawler?.runCrawlBatch) {
    return crawler.runCrawlBatch({ limit, concurrency, tenantId });
  }
  return { adapter: "none", crawled: 0, note: "crawl-scheduler missing" };
}

async function runScore(limit: number, tenantId?: string) {
  const scorer = await tryImport<any>(
    path.resolve(process.cwd(), "src/scorecard.ts"),
    path.resolve(process.cwd(), "src/scorecard.js")
  );
  if (scorer?.scorePending) {
    return scorer.scorePending({ limit, tenantId });
  }
  return { adapter: "none", scored: 0, note: "scorecard module missing" };
}

async function runRoute(limit: number, tenantId?: string) {
  const router = await tryImport<any>(
    path.resolve(process.cwd(), "src/lead-router.ts"),
    path.resolve(process.cwd(), "src/lead-router.js")
  );
  if (router?.routeLeads) {
    return router.routeLeads({ limit, tenantId });
  }
  return { adapter: "none", routed: 0, note: "lead-router missing" };
}

async function runNotify(limit: number, tenantId?: string) {
  const notifier = await tryImport<any>(
    path.resolve(process.cwd(), "src/notifications.ts"),
    path.resolve(process.cwd(), "src/notifications.js")
  );
  if (notifier?.dispatchNotifications) {
    return notifier.dispatchNotifications({ limit, tenantId });
  }
  return { adapter: "none", notified: 0, note: "notifications missing" };
}

export async function runCronJob(input: RunOpts) {
  const job = (input.job || "").toLowerCase() as JobName;
  const limit = input.limit ?? 100;
  const concurrency = input.concurrency ?? 5;
  const tenantId = input.tenantId;

  switch (job) {
    case "discover":
      return runDiscover(limit, tenantId);
    case "crawl":
      return runCrawl(limit, concurrency, tenantId);
    case "score":
      return runScore(limit, tenantId);
    case "route":
      return runRoute(limit, tenantId);
    case "notify":
      return runNotify(limit, tenantId);
    default:
      throw new Error(`Unknown job "${input.job}". Use: discover|crawl|score|route|notify`);
  }
}

// CLI
if (require.main === module) {
  (async () => {
    try {
      const args = parseArgs();
      const out = await runCronJob(args);
      console.log(JSON.stringify({ ok: true, job: args.job, result: out }, null, 2));
    } catch (err) {
      console.error(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2));
      process.exit(1);
    }
  })();
}
