import { existsSync } from "node:fs";
import { join } from "node:path";
import { quoteIdent, quoteString, type Duck } from "@cook/duck";
import type { Logger } from "./log.js";
import { listBatches, rawDir, readDone } from "./fetch.js";
import { SOURCES, type Source } from "./sources.js";

export const rawTable = (s: Source) => `raw_${s.system}`;

export async function ensureStageSchema(db: Duck): Promise<void> {
  await db.exec(`create table if not exists staged_batch(
    source_system varchar, batch_id varchar, rows_in_batch bigint, staged_at timestamp, run_id varchar,
    primary key (source_system, batch_id))`);
  await db.exec(`create table if not exists source_watermark(
    source_system varchar primary key, watermark_field varchar, watermark_value varchar, last_run_id varchar)`);
  for (const s of SOURCES) {
    const cols = s.fields.map((f) => `${quoteIdent(f)} varchar`).join(", ");
    await db.exec(`create table if not exists ${rawTable(s)}(
      ${cols}, source_record_key varchar primary key, source_record_hash varchar, socrata_id varchar, updated_at varchar)`);
  }
}

export interface StageResult {
  source_system: string;
  batches_staged: string[];
  rows_staged: number;
  rows_total: number;
  watermark_value: string | null;
}

/** Upsert every completed batch not yet staged into raw_<source>; advance watermarks. Idempotent. */
export async function stageAll(
  db: Duck,
  dataDir: string,
  runId: string,
  log: Logger,
  sources: readonly Source[] = SOURCES,
): Promise<StageResult[]> {
  await ensureStageSchema(db);
  const out: StageResult[] = [];
  for (const s of sources) {
    const res: StageResult = {
      source_system: s.system,
      batches_staged: [],
      rows_staged: 0,
      rows_total: 0,
      watermark_value: null,
    };
    for (const batch of listBatches(dataDir, s.system)) {
      const dir = rawDir(dataDir, s.system, batch);
      const done = readDone(dir);
      if (!done) continue;
      const already = await db.scalar<number>(
        "select count(*) from staged_batch where source_system = ? and batch_id = ?",
        [s.system, batch],
      );
      if (Number(already) > 0) continue;
      if (!existsSync(join(dir, "page-00000.ndjson"))) {
        await db.exec("insert into staged_batch values (?, ?, 0, now(), ?)", [
          s.system,
          batch,
          runId,
        ]);
        continue;
      }
      const t0 = Date.now();
      const cols = s.fields.map((f) => `nullif(${quoteIdent(f)}, '')`);
      const colSpec = [...s.fields, "_key", "_hash", "_id", "_updated_at"]
        .map((f) => `${quoteIdent(f)}: 'VARCHAR'`)
        .join(", ");
      const glob = quoteString(join(dir, "page-*.ndjson"));
      await db.exec(`insert or replace into ${rawTable(s)}
        select ${cols.join(", ")}, _key, _hash, _id, _updated_at
        from read_ndjson(${glob}, columns = {${colSpec}}, format = 'newline_delimited')
        qualify row_number() over (partition by _key order by _updated_at desc nulls last) = 1`);
      await db.exec("insert into staged_batch values (?, ?, ?, now(), ?)", [
        s.system,
        batch,
        done.rows_fetched,
        runId,
      ]);
      res.batches_staged.push(batch);
      res.rows_staged += done.rows_fetched;
      log.info({ source: s.system, batch, rows: done.rows_fetched, ms: Date.now() - t0 }, "staged");
    }
    res.rows_total = await db.count(rawTable(s));
    const wm = await db.scalar<string | null>(`select max(updated_at) from ${rawTable(s)}`);
    res.watermark_value = wm ?? null;
    if (res.batches_staged.length) {
      await db.exec("insert or replace into source_watermark values (?, ':updated_at', ?, ?)", [
        s.system,
        res.watermark_value,
        runId,
      ]);
    }
    out.push(res);
  }
  return out;
}

export async function readWatermark(db: Duck, system: string): Promise<string | null> {
  await ensureStageSchema(db);
  const r = await db.one<{ watermark_value: string | null }>(
    "select watermark_value from source_watermark where source_system = ?",
    [system],
  );
  return r?.watermark_value ?? null;
}
