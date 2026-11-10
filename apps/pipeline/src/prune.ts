import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "./log.js";

export interface PruneOptions {
  dataDir: string;
  /** committed manifest dir: a run with `<publicationsDir>/<run_id>/manifest.json` is never deleted */
  publicationsDir: string;
  /** newest run directories to keep besides published ones (default 2) */
  keep?: number;
  /** newest `inc-*` raw batches to keep per source (default 3); `full` and `sample` are kept */
  keepRaw?: number;
  /** the run in progress; never deleted even when older than the newest `keep` */
  currentRunId?: string | undefined;
  dryRun?: boolean;
  log: Logger;
}

export interface PruneResult {
  dry_run: boolean;
  kept: string[];
  deleted: { run_id: string; bytes: number }[];
  raw_deleted: { source: string; batch: string; bytes: number }[];
  bytes_freed: number;
}

export function dirSize(p: string): number {
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((n, f) => n + dirSize(join(p, f)), 0);
}

const subdirs = (p: string): string[] =>
  existsSync(p)
    ? readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];

export const isPublished = (publicationsDir: string, runId: string): boolean =>
  existsSync(join(publicationsDir, runId, "manifest.json"));

/** Delete old `data/dataset/<run_id>` snapshots and old `data/raw/<source>/inc-*` batches. */
export function prune(o: PruneOptions): PruneResult {
  const keep = o.keep ?? 2;
  const keepRaw = o.keepRaw ?? 3;
  const dryRun = o.dryRun ?? false;
  const datasetDir = join(o.dataDir, "dataset");
  // run ids are compact ISO timestamps, so lexical order is chronological
  const runs = subdirs(datasetDir).sort().reverse();
  const newest = new Set(runs.slice(0, keep));
  const res: PruneResult = {
    dry_run: dryRun,
    kept: [],
    deleted: [],
    raw_deleted: [],
    bytes_freed: 0,
  };
  const remove = (p: string) => {
    if (!dryRun) rmSync(p, { recursive: true, force: true });
  };
  for (const runId of runs) {
    const published = isPublished(o.publicationsDir, runId);
    if (published || newest.has(runId) || runId === o.currentRunId) {
      res.kept.push(runId);
      continue;
    }
    const bytes = dirSize(join(datasetDir, runId));
    remove(join(datasetDir, runId));
    res.deleted.push({ run_id: runId, bytes });
    res.bytes_freed += bytes;
    o.log.info({ run_id: runId, bytes, dry_run: dryRun }, "pruned run directory");
  }
  for (const source of subdirs(join(o.dataDir, "raw"))) {
    const inc = subdirs(join(o.dataDir, "raw", source))
      .filter((b) => b.startsWith("inc-"))
      .sort()
      .reverse();
    for (const batch of inc.slice(keepRaw)) {
      if (batch === `inc-${o.currentRunId}`) continue;
      const p = join(o.dataDir, "raw", source, batch);
      const bytes = dirSize(p);
      remove(p);
      res.raw_deleted.push({ source, batch, bytes });
      res.bytes_freed += bytes;
      o.log.info({ source, batch, bytes, dry_run: dryRun }, "pruned raw batch");
    }
  }
  o.log.info(
    {
      kept: res.kept.length,
      deleted: res.deleted.length,
      raw_deleted: res.raw_deleted.length,
      bytes_freed: res.bytes_freed,
      dry_run: dryRun,
    },
    "prune summary",
  );
  return res;
}
