export interface CSEItem {
publishedAt: String(it?.pagemap?.metatags?.[0]?.["article:published_time"] ?? ""),
source: (() => {
try {
const u = new URL(String(it.link ?? ""));
return u.hostname.replace(/^www\./, "");
} catch {
return "";
}
})(),
})) as CSEItem[];
} catch (err) {
logger.error(`[CSE] fetch failed for query: ${query} →`, err);
return [];
}
}


/**
* Main entry — polls Google CSE for a list of queries.
* Returns a de-duplicated list of results across queries.
*/
export async function pollCSE(options: PollCSEOptions): Promise<CSEItem[]> {
const logger = options.logger ?? console;


if (!CSE_ENABLED) {
logger.warn("[CSE] Disabled: GOOGLE_CSE_KEY or GOOGLE_CSE_CX missing.");
return [];
}


const maxResultsPerQuery = options.maxResultsPerQuery ?? 5;
const delayMsBetweenQueries = options.delayMsBetweenQueries ?? 250;
const safe = options.safe ?? "off";


const queries = uniq(options.queries.map(normalizeQuery).filter(Boolean));
if (!queries.length) return [];


const all: CSEItem[] = [];
const seen = new Set<string>();


for (let i = 0; i < queries.length; i++) {
const q = queries[i];
const batch = await searchOnce(q, {
queries,
maxResultsPerQuery,
delayMsBetweenQueries,
safe,
logger,
} as Required<PollCSEOptions>);


for (const item of batch) {
const key = item.link;
if (!seen.has(key)) {
seen.add(key);
all.push(item);
}
}


if (i < queries.length - 1 && delayMsBetweenQueries > 0) {
await sleep(delayMsBetweenQueries);
}
}


return all;
}


// ————————————————————————————————————————————————
// Aliases (keep older imports working)
// ————————————————————————————————————————————————
export const runCSE = pollCSE;
export const searchCSE = pollCSE;


export default { pollCSE, runCSE, searchCSE, CSE_ENABLED };
