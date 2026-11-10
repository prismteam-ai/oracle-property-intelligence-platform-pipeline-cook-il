import type { Dataset, Row } from "./db/duck.js";
import { RunSchema, type Run, type SourceCount } from "./contract.js";
import { TABLES } from "./db/duck.js";

function json(v: unknown): unknown {
  let out = v;
  for (let i = 0; i < 2 && typeof out === "string"; i++) {
    try {
      out = JSON.parse(out);
    } catch {
      return out;
    }
  }
  return out;
}

export function rowToRun(row: Row): Run {
  return RunSchema.parse({
    ...row,
    sources: json(row.sources) ?? [],
    counts: json(row.counts) ?? {},
    deltas: json(row.deltas) ?? {},
    dead_letters: json(row.dead_letters) ?? [],
    limitations: json(row.limitations) ?? [],
    manifest_cid: row.manifest_cid ?? null,
    root_cid: row.root_cid ?? null,
    previous_run_id: row.previous_run_id ?? null,
    finished_at: row.finished_at ?? null,
  });
}

export async function listRuns(ds: Dataset, pubDirs: string[] = []): Promise<Run[]> {
  const rows = await ds.query("SELECT * FROM run ORDER BY started_at DESC");
  return rows.map((r) => withPublication(rowToRun(r), pubDirs));
}

export async function getRun(ds: Dataset, runId: string): Promise<Run | null> {
  const rows = await ds.query("SELECT * FROM run WHERE run_id = ?", [runId]);
  const row = rows[0];
  return row ? rowToRun(row) : null;
}

export async function latestRun(ds: Dataset): Promise<Run | null> {
  const rows = await ds.query("SELECT * FROM run ORDER BY started_at DESC LIMIT 1");
  const row = rows[0];
  return row ? rowToRun(row) : null;
}

/** Live row counts per query table (what is actually in the snapshot, independent of run.counts). */
export async function tableCounts(ds: Dataset): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    try {
      const rows = await ds.query(`SELECT count(*)::INTEGER AS n FROM ${t}`);
      out[t] = Number(rows[0]?.n ?? 0);
    } catch {
      out[t] = -1; // table missing in this snapshot
    }
  }
  return out;
}

export interface SourceStatus extends SourceCount {
  /** newest run that actually fetched rows for this source (rows_fetched > 0); null if none in history */
  last_fetch: { run_id: string; rows_fetched: number; fetched_at: string | null } | null;
  /** source_watermark row (what incremental fetches resume from) */
  watermark: { field: string; value: string | null; last_run_id: string } | null;
}

/** Latest run's sources plus the last run that fetched each (a cached/incremental run reports 0 rows, not the dataset's state). */
export async function sourceStatus(ds: Dataset, runs: Run[]): Promise<SourceStatus[]> {
  const latest = runs[0];
  if (!latest) return [];
  const wm = await ds.query("SELECT * FROM source_watermark").catch(() => [] as Row[]);
  return latest.sources.map((src) => {
    let last_fetch: SourceStatus["last_fetch"] = null;
    for (const r of runs) {
      const x = r.sources.find((y) => y.source_system === src.source_system);
      if (x && x.rows_fetched > 0) {
        last_fetch = { run_id: r.run_id, rows_fetched: x.rows_fetched, fetched_at: x.fetched_at };
        break;
      }
    }
    const w = wm.find((y) => y.source_system === src.source_system);
    return {
      ...src,
      last_fetch,
      watermark: w
        ? {
            field: String(w.watermark_field),
            value: typeof w.watermark_value === "string" ? w.watermark_value : null,
            last_run_id: String(w.last_run_id),
          }
        : null,
    };
  });
}

export interface Coverage {
  county: string;
  municipalities: number;
  properties_with_coordinates: number;
  properties_total: number;
  bbox: { min_lat: number; max_lat: number; min_lon: number; max_lon: number } | null;
  roofing_permits: number;
  open_roofing_permits: number;
  long_open_roofing_permits: number;
  contractors_with_bbb: number;
  contractors_total: number;
  out_of_area_owners: number;
  no_sale_over_10y: number;
  roof_over_15y: number;
  top_municipalities: { municipality: string; properties: number }[];
}

export async function coverage(ds: Dataset): Promise<Coverage> {
  const [p] = await ds.query(`SELECT count(*)::INTEGER AS total, count(lat)::INTEGER AS with_coords,
      count(DISTINCT municipality)::INTEGER AS munis, min(lat) AS min_lat, max(lat) AS max_lat, min(lon) AS min_lon, max(lon) AS max_lon,
      sum(is_out_of_area::INTEGER)::INTEGER AS ooa, sum((years_since_sale > 10)::INTEGER)::INTEGER AS s10, sum((roof_age_years > 15)::INTEGER)::INTEGER AS r15 FROM property`);
  const [pm] =
    await ds.query(`SELECT sum(is_roofing::INTEGER)::INTEGER AS roofing, sum((is_roofing AND status_is_open)::INTEGER)::INTEGER AS open_roofing,
      sum((is_roofing AND status_is_open AND open_days > 365 * 3)::INTEGER)::INTEGER AS long_open FROM permit`);
  const [c] = await ds.query(
    `SELECT count(*)::INTEGER AS total, count(bbb_rating)::INTEGER AS with_bbb FROM contractor`,
  );
  const top = await ds.query(
    `SELECT coalesce(municipality, '(unknown)') AS municipality, count(*)::INTEGER AS properties FROM property GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
  );
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return {
    county: "Cook County, IL",
    municipalities: n(p?.munis),
    properties_with_coordinates: n(p?.with_coords),
    properties_total: n(p?.total),
    bbox:
      p?.min_lat === null || p?.min_lat === undefined
        ? null
        : {
            min_lat: n(p.min_lat),
            max_lat: n(p.max_lat),
            min_lon: n(p.min_lon),
            max_lon: n(p.max_lon),
          },
    roofing_permits: n(pm?.roofing),
    open_roofing_permits: n(pm?.open_roofing),
    long_open_roofing_permits: n(pm?.long_open),
    contractors_with_bbb: n(c?.with_bbb),
    contractors_total: n(c?.total),
    out_of_area_owners: n(p?.ooa),
    no_sale_over_10y: n(p?.s10),
    roof_over_15y: n(p?.r15),
    top_municipalities: top.map((r) => ({
      municipality: String(r.municipality),
      properties: n(r.properties),
    })),
  };
}

import { getPublication, publishedRunIds } from "./publications.js";
import type { Source } from "./mcp/contracts.js";

/** CIDs of a run: the run row first, else its publication files (manifest.json + run.json). */
export function withPublication(run: Run, pubDirs: string[]): Run {
  if (run.root_cid && run.manifest_cid) return run;
  const pub = getPublication(pubDirs, run.run_id);
  if (!pub.manifest) return run;
  return {
    ...run,
    root_cid: run.root_cid ?? pub.manifest.root_cid,
    manifest_cid: run.manifest_cid ?? pub.manifest_cid,
    previous_run_id: run.previous_run_id ?? pub.manifest.previous_run_id,
  };
}

/**
 * Newest *published* run at or before `run`: walk previous_run_id, then fall back to the
 * publication dirs (run ids are UTC timestamps, so lexical order is time order).
 */
export async function newestPublished(
  ds: Dataset,
  pubDirs: string[],
  run: Run,
): Promise<Run | null> {
  const seen = new Set<string>();
  for (let cur: Run | null = run; cur && !seen.has(cur.run_id);) {
    seen.add(cur.run_id);
    const r = withPublication(cur, pubDirs);
    if (r.root_cid) return r;
    cur = cur.previous_run_id ? await getRun(ds, cur.previous_run_id) : null;
  }
  const id = publishedRunIds(pubDirs).find((p) => p <= run.run_id);
  if (!id) return null;
  const row = await getRun(ds, id);
  const pub = getPublication(pubDirs, id);
  return row
    ? withPublication(row, pubDirs)
    : {
        run_id: id,
        started_at: pub.manifest?.created_at ?? "",
        finished_at: pub.manifest?.created_at ?? null,
        status: "ok",
        mode: "full",
        sources: [],
        counts: {},
        deltas: {},
        dead_letters: [],
        limitations: [],
        root_cid: pub.manifest?.root_cid ?? null,
        manifest_cid: pub.manifest_cid,
        previous_run_id: pub.manifest?.previous_run_id ?? null,
      };
}

export interface DatasetInfo {
  run: Run;
  source: Source;
}

/** Latest run + the provenance block every API/MCP response carries. Snapshot is immutable per process, so cache it. */
export async function datasetInfo(ds: Dataset, pubDirs: string[]): Promise<DatasetInfo> {
  const run = await latestRun(ds);
  if (!run) throw new Error("dataset has no run rows");
  const published = await newestPublished(ds, pubDirs, run);
  return {
    run: withPublication(run, pubDirs),
    source: {
      runId: run.run_id,
      rootCid: published?.root_cid ?? null,
      manifestCid: published?.manifest_cid ?? null,
      publishedRunId: published?.run_id ?? null,
      syncedAt: run.finished_at ?? run.started_at,
    },
  };
}
