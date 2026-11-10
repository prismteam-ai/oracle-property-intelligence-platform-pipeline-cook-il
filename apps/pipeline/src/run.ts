import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Duck } from "@cook/duck";
import type { DeadLetter, Delta, Run, SourceCount } from "@cook/shared";
import { fetchSources, type FetchResult } from "./fetch.js";
import type { Logger } from "./log.js";
import { readWatermark, stageAll, type StageResult } from "./stage.js";
import type { SocrataAuth } from "./socrata.js";
import { SOURCES, datasetPageUrl, type Source } from "./sources.js";
import { LIMITATIONS, transform, type TransformResult } from "./transform.js";

export async function ensureRunSchema(db: Duck): Promise<void> {
  await db.exec(`create table if not exists run(
    run_id varchar primary key, started_at timestamp, finished_at timestamp, status varchar, mode varchar,
    sources json, counts json, deltas json, dead_letters json, limitations json,
    manifest_cid varchar, root_cid varchar, previous_run_id varchar)`);
  await db.exec(`create table if not exists dead_letter(
    run_id varchar, source_system varchar, stage varchar, key varchar, error varchar, occurred_at timestamp)`);
}

export interface RunContext {
  db: Duck;
  dataDir: string;
  auth: SocrataAuth;
  log: Logger;
  runId: string;
  incremental: boolean;
  sources?: readonly Source[] | undefined;
  sampleRows?: number | undefined;
}

export async function startRun(c: RunContext): Promise<void> {
  await ensureRunSchema(c.db);
  // a run left 'running' by a killed process is closed out as failed so history stays honest
  const interrupted: DeadLetter = {
    source_system: "*",
    stage: "transform",
    key: null,
    error: "interrupted: process exited before finishing",
    at: new Date().toISOString(),
  };
  await c.db.exec(
    "update run set status = 'failed', finished_at = now(), dead_letters = ?::json where status = 'running'",
    [JSON.stringify([interrupted])],
  );
  const prev = await c.db.one<{ run_id: string }>(
    "select run_id from run order by started_at desc limit 1",
  );
  await c.db.exec(
    `insert into run values (?, now(), null, 'running', ?, '[]', '{}', '{}', '[]', ?, null, null, ?)`,
    [
      c.runId,
      c.incremental ? "incremental" : "full",
      JSON.stringify(LIMITATIONS),
      prev?.run_id ?? null,
    ],
  );
}

export async function finishRun(
  c: RunContext,
  status: "ok" | "failed",
  parts: {
    fetch?: FetchResult[] | undefined;
    stage?: StageResult[] | undefined;
    transform?: TransformResult | undefined;
    error?: string | undefined;
  },
): Promise<Run> {
  const sources: SourceCount[] = (c.sources ?? SOURCES).map((s) => {
    const f = parts.fetch?.find((x) => x.source_system === s.system);
    const st = parts.stage?.find((x) => x.source_system === s.system);
    return {
      source_system: s.system,
      dataset_id: s.datasetId,
      url: datasetPageUrl(s),
      rows_fetched: f?.done?.rows_fetched ?? 0,
      rows_staged: st?.rows_total ?? 0,
      watermark_value: st?.watermark_value ?? null,
      fetched_at: f?.done?.finished_at ?? null,
    };
  });
  const dead: DeadLetter[] = (parts.fetch ?? []).flatMap((f) =>
    f.dead_letters.map((d) => ({
      source_system: f.source_system,
      stage: "fetch" as const,
      key: d.key,
      error: d.error,
      at: d.at,
    })),
  );
  if (parts.error)
    dead.push({
      source_system: "*",
      stage: "transform",
      key: null,
      error: parts.error,
      at: new Date().toISOString(),
    });
  for (const d of dead) {
    await c.db.exec("insert into dead_letter values (?, ?, ?, ?, ?, ?)", [
      c.runId,
      d.source_system,
      d.stage,
      d.key,
      d.error,
      d.at,
    ]);
  }
  const counts = parts.transform?.counts ?? {};
  const deltas: Record<string, Delta> = parts.transform?.deltas ?? {};
  await c.db.exec(
    `update run set finished_at = now(), status = ?, sources = ?::json, counts = ?::json, deltas = ?::json, dead_letters = ?::json where run_id = ?`,
    [
      status,
      JSON.stringify(sources),
      JSON.stringify(counts),
      JSON.stringify(deltas),
      JSON.stringify(dead),
      c.runId,
    ],
  );
  const row = await c.db.one<Record<string, string>>("select * from run where run_id = ?", [
    c.runId,
  ]);
  if (!row) throw new Error("run row missing");
  return {
    run_id: c.runId,
    started_at: row["started_at"] ?? "",
    finished_at: row["finished_at"] ?? null,
    status,
    mode: c.incremental ? "incremental" : "full",
    sources,
    counts,
    deltas,
    dead_letters: dead,
    limitations: LIMITATIONS,
    manifest_cid: null,
    root_cid: null,
    previous_run_id: row["previous_run_id"] ?? null,
  };
}

export async function fetchStep(c: RunContext): Promise<FetchResult[]> {
  const sources = c.sources ?? SOURCES;
  if (c.sampleRows) {
    return fetchSources({
      dataDir: c.dataDir,
      auth: c.auth,
      log: c.log,
      batchId: "sample",
      sampleRows: c.sampleRows,
      sources,
    });
  }
  if (!c.incremental) {
    return fetchSources({ dataDir: c.dataDir, auth: c.auth, log: c.log, batchId: "full", sources });
  }
  const until = new Date().toISOString();
  const out: FetchResult[] = [];
  for (const s of sources) {
    const since = await readWatermark(c.db, s.system);
    if (!since) {
      c.log.warn({ source: s.system }, "no watermark; incremental falls back to full batch");
      out.push(
        ...(await fetchSources({
          dataDir: c.dataDir,
          auth: c.auth,
          log: c.log,
          batchId: "full",
          sources: [s],
        })),
      );
      continue;
    }
    out.push(
      ...(await fetchSources({
        dataDir: c.dataDir,
        auth: c.auth,
        log: c.log,
        batchId: `inc-${c.runId}`,
        incremental: { since, until },
        sources: [s],
      })),
    );
  }
  return out;
}

/** fetch + stage + transform with a run row; dead letters never abort the run, transform errors do. */
export async function runAll(c: RunContext): Promise<Run> {
  await startRun(c);
  let fetch: FetchResult[] | undefined;
  let stage: StageResult[] | undefined;
  try {
    fetch = await fetchStep(c);
    stage = await stageAll(c.db, c.dataDir, c.runId, c.log, c.sources);
    const t = await transform(c.db, { dataDir: c.dataDir, runId: c.runId, log: c.log });
    return await finishRun(c, "ok", { fetch, stage, transform: t });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    c.log.error({ error }, "run failed");
    await finishRun(c, "failed", { fetch, stage, error });
    throw e;
  }
}

export function readBuildInfo(root: string): { commit: string; builtAt: string } {
  const p = join(root, "build.json");
  if (existsSync(p))
    return JSON.parse(readFileSync(p, "utf8")) as { commit: string; builtAt: string };
  return { commit: process.env["GIT_COMMIT"] ?? "unknown", builtAt: "unknown" };
}
