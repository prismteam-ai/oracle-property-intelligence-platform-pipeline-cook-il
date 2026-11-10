import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import pLimit from "p-limit";
import { z } from "zod";
import type { Logger } from "./log.js";
import {
  PAGE_LIMIT,
  canonicalize,
  countUrl,
  fetchJson,
  pageUrl,
  whereClause,
  type RawRow,
  type SocrataAuth,
} from "./socrata.js";
import { SOURCES, type Source } from "./sources.js";

export const DoneMarker = z.object({
  batch_id: z.string(),
  source_system: z.string(),
  count: z.number().int(),
  pages: z.number().int(),
  rows_fetched: z.number().int(),
  max_updated_at: z.string().nullable(),
  where: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string(),
  seconds: z.number(),
});
export type DoneMarker = z.infer<typeof DoneMarker>;

export interface FetchOptions {
  dataDir: string;
  auth: SocrataAuth;
  log: Logger;
  /** 'full' | 'sample' | 'inc-<run_id>' */
  batchId: string;
  incremental?: { since: string; until: string } | undefined;
  /** cap rows (sample mode) */
  sampleRows?: number | undefined;
  sources?: readonly Source[] | undefined;
  concurrencyPerHost?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface FetchResult {
  source_system: string;
  batch_id: string;
  done: DoneMarker | null;
  dead_letters: { key: string | null; error: string; at: string }[];
}

export function rawDir(dataDir: string, system: string, batchId: string): string {
  return join(dataDir, "raw", system, batchId);
}
export function readDone(dir: string): DoneMarker | null {
  const p = join(dir, "_done.json");
  if (!existsSync(p)) return null;
  return DoneMarker.parse(JSON.parse(readFileSync(p, "utf8")));
}

const CountRow = z.array(
  z.object({ n: z.coerce.number(), max_updated_at: z.string().nullable().optional() }),
);

/** Resumable paged download: page files are written atomically; existing pages are skipped. */
export async function fetchSources(o: FetchOptions): Promise<FetchResult[]> {
  const limits = new Map<string, ReturnType<typeof pLimit>>();
  const limitFor = (host: string) => {
    let l = limits.get(host);
    if (!l) limits.set(host, (l = pLimit(o.concurrencyPerHost ?? 4)));
    return l;
  };
  const sources = o.sources ?? SOURCES;
  return Promise.all(sources.map((s) => fetchSource(s, o, limitFor(s.host))));
}

async function fetchSource(
  s: Source,
  o: FetchOptions,
  limit: ReturnType<typeof pLimit>,
): Promise<FetchResult> {
  const dir = rawDir(o.dataDir, s.system, o.batchId);
  mkdirSync(dir, { recursive: true });
  const log = o.log.child({ source: s.system, batch: o.batchId });
  const existing = readDone(dir);
  if (existing) {
    log.info({ rows: existing.rows_fetched }, "fetch already complete, skipping");
    return { source_system: s.system, batch_id: o.batchId, done: existing, dead_letters: [] };
  }
  const started = new Date();
  const where = whereClause(s, o.incremental);
  const fetchOpts = { auth: o.auth, fetchImpl: o.fetchImpl };
  const countRows = CountRow.parse(await fetchJson(countUrl(s, where), fetchOpts));
  const total = Math.min(countRows[0]?.n ?? 0, o.sampleRows ?? Number.MAX_SAFE_INTEGER);
  const pageSize = Math.min(PAGE_LIMIT, o.sampleRows ?? PAGE_LIMIT);
  const pages = Math.ceil(total / pageSize);
  log.info({ total, pages, where: where ?? null }, "fetch start");

  const dead: FetchResult["dead_letters"] = [];
  let rows = 0;
  let maxUpdated: string | null = null;
  const tasks = Array.from({ length: pages }, (_, i) =>
    limit(async () => {
      const file = join(dir, `page-${String(i).padStart(5, "0")}.ndjson`);
      if (existsSync(file)) {
        const stats = scanPage(file);
        rows += stats.rows;
        maxUpdated = maxStr(maxUpdated, stats.maxUpdated);
        return;
      }
      const t0 = Date.now();
      try {
        const raw = (await fetchJson(
          pageUrl(s, i * pageSize, pageSize, where),
          fetchOpts,
        )) as RawRow[];
        const lines: string[] = [];
        for (const r of raw) {
          const c = canonicalize(s, r);
          maxUpdated = maxStr(maxUpdated, c["_updated_at"] ?? null);
          lines.push(JSON.stringify(c));
        }
        writeFileSync(file + ".tmp", lines.length ? lines.join("\n") + "\n" : "");
        renameSync(file + ".tmp", file);
        rows += lines.length;
        log.info({ page: i, rows: lines.length, ms: Date.now() - t0 }, "page");
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const at = new Date().toISOString();
        dead.push({ key: `page-${i}`, error, at });
        appendFileSync(join(dir, "_dead.ndjson"), JSON.stringify({ page: i, error, at }) + "\n");
        log.error({ page: i, error }, "page failed");
      }
    }),
  );
  await Promise.all(tasks);
  if (dead.length) {
    log.warn({ failed: dead.length }, "fetch incomplete; rerun to resume");
    return { source_system: s.system, batch_id: o.batchId, done: null, dead_letters: dead };
  }
  const finished = new Date();
  const done: DoneMarker = {
    batch_id: o.batchId,
    source_system: s.system,
    count: total,
    pages,
    rows_fetched: rows,
    max_updated_at: maxUpdated,
    where: where ?? null,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    seconds: (finished.getTime() - started.getTime()) / 1000,
  };
  writeFileSync(join(dir, "_done.json"), JSON.stringify(done, null, 2));
  log.info({ rows, seconds: done.seconds }, "fetch done");
  return { source_system: s.system, batch_id: o.batchId, done, dead_letters: [] };
}

function scanPage(file: string): { rows: number; maxUpdated: string | null } {
  const text = readFileSync(file, "utf8");
  let rows = 0;
  let maxUpdated: string | null = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    rows++;
    const m = /"_updated_at":"([^"]+)"/.exec(line);
    if (m) maxUpdated = maxStr(maxUpdated, m[1] ?? null);
  }
  return { rows, maxUpdated };
}

function maxStr(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/** Batches on disk for a source, oldest first (full, sample, inc-* sorted by run id). */
export function listBatches(dataDir: string, system: string): string[] {
  const base = join(dataDir, "raw", system);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
const rank = (b: string) => (b === "full" ? 0 : b === "sample" ? 1 : 2);
