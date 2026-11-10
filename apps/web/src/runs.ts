import type { Dataset, Row } from './db/duck.js';
import { RunSchema, type Run } from './contract.js';
import { TABLES } from './db/duck.js';

function json(v: unknown): unknown {
  let out = v;
  for (let i = 0; i < 2 && typeof out === 'string'; i++) {
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

export async function listRuns(ds: Dataset): Promise<Run[]> {
  const rows = await ds.query('SELECT * FROM run ORDER BY started_at DESC');
  return rows.map(rowToRun);
}

export async function getRun(ds: Dataset, runId: string): Promise<Run | null> {
  const rows = await ds.query('SELECT * FROM run WHERE run_id = ?', [runId]);
  const row = rows[0];
  return row ? rowToRun(row) : null;
}

export async function latestRun(ds: Dataset): Promise<Run | null> {
  const rows = await ds.query('SELECT * FROM run ORDER BY started_at DESC LIMIT 1');
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
    county: 'Cook County, IL',
    municipalities: n(p?.munis),
    properties_with_coordinates: n(p?.with_coords),
    properties_total: n(p?.total),
    bbox:
      p?.min_lat === null || p?.min_lat === undefined
        ? null
        : { min_lat: n(p.min_lat), max_lat: n(p.max_lat), min_lon: n(p.min_lon), max_lon: n(p.max_lon) },
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

import { getPublication } from './publications.js';
import type { Source } from './mcp/contracts.js';

export interface DatasetInfo {
  run: Run;
  source: Source;
}

/** Latest run + the provenance block every API/MCP response carries. Snapshot is immutable per process, so cache it. */
export async function datasetInfo(ds: Dataset, pubDirs: string[]): Promise<DatasetInfo> {
  const run = await latestRun(ds);
  if (!run) throw new Error('dataset has no run rows');
  const pub = getPublication(pubDirs, run.run_id);
  return {
    run,
    source: {
      runId: run.run_id,
      rootCid: run.root_cid ?? pub.manifest?.root_cid ?? null,
      manifestCid: run.manifest_cid ?? pub.manifest?.manifest_cid ?? null,
      tablesCid: pub.manifest?.tables_cid ?? null,
      syncedAt: run.finished_at ?? run.started_at,
    },
  };
}
