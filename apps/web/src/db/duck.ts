import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from "@duckdb/node-api";
import { legacySourceUrlSql } from "@cook/shared";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { publishedSnapshot } from "./snapshot.js";
import { publishedRunIds } from "../publications.js";
import { logger } from "../logger.js";

export type Row = Record<string, unknown>;
export const TABLES = [
  "property",
  "permit",
  "contractor",
  "business",
  "sale",
  "property_improvement_has_contractor",
  "contractor_has_license",
  "run",
  "source_watermark",
] as const;

export interface Dataset {
  /** Where rows come from: the duckdb file or a parquet run directory. */
  readonly origin:
    { kind: "duckdb"; path: string } | { kind: "parquet"; runId: string; dir: string };
  query(sql: string, params?: DuckDBValue[], timeoutMs?: number): Promise<Row[]>;
  close(): Promise<void>;
  /** Published serving: switch to a newer verified publication / reload run history. True when anything changed. */
  refresh?(): Promise<boolean>;
  /** Increments whenever refresh() changed the snapshot or its run history. */
  readonly version?: number;
}

/** Newest `<datasetDir>/<run_id>` directory that is newer than the duckdb file, if any. */
export function newerParquetRun(
  dbPath: string,
  datasetDir: string,
): { runId: string; dir: string } | null {
  if (!existsSync(datasetDir)) return null;
  const dbMtime = existsSync(dbPath) ? statSync(dbPath).mtimeMs : 0;
  const runs = readdirSync(datasetDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(datasetDir, d.name, "property")))
    .map((d) => ({
      runId: d.name,
      dir: join(datasetDir, d.name),
      mtime: statSync(join(datasetDir, d.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  const newest = runs[0];
  return newest && newest.mtime > dbMtime ? { runId: newest.runId, dir: newest.dir } : null;
}

/**
 * Sandbox a connection: no file system / network access from SQL (read_csv('/etc/passwd'), read_text, glob,
 * httpfs...), except the parquet run directory when the dataset is served from it. lock_configuration makes the
 * sandbox immutable for the rest of the connection; the SQL guard is only a second line.
 */
export async function lockdown(conn: DuckDBConnection, allowedDir?: string): Promise<void> {
  await conn.run("SET TimeZone = 'UTC'");
  if (allowedDir) await conn.run(`SET allowed_directories = ['${allowedDir.replace(/'/g, "''")}']`);
  await conn.run("SET enable_external_access = false");
  await conn.run("SET lock_configuration = true");
}

export async function openDataset(
  dbPath: string,
  datasetDir: string,
  serving?: { pubDirs: string[]; historyPath: string },
): Promise<Dataset> {
  let published = serving
    ? await publishedSnapshot(datasetDir, serving.pubDirs, serving.historyPath)
    : null;
  // Production serving with publications must never fall through to the writer's DB.
  if (serving && !published) throw new Error("no verified published snapshot available locally");
  let parquet = published ?? newerParquetRun(dbPath, datasetDir);
  const mtime = (p: string): number => (existsSync(p) ? statSync(p).mtimeMs : 0);
  let historyMtime = serving ? mtime(serving.historyPath) : 0;
  let seenNewest = serving ? publishedRunIds(serving.pubDirs)[0] : undefined;
  let version = 0;
  // One instance per query, closed right after: DuckDB holds a file lock for the lifetime of an
  // instance (even READ_ONLY), and the pipeline in the sibling container needs the exclusive
  // read-write lock on cook_il.duckdb for every run.
  const open = async (): Promise<DuckDBInstance> => {
    if (!parquet) return DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" });
    const instance = await DuckDBInstance.create(":memory:");
    const setup = await instance.connect();
    for (const t of TABLES) {
      const dir = join(parquet.dir, t);
      if (!existsSync(dir)) continue;
      const paths = published
        ? published.files.filter((f) => f.startsWith(resolve(dir) + "/") && f.endsWith(".parquet"))
        : [resolve(dir, "*.parquet")];
      if (!paths.length) continue;
      const input = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(", ");
      await setup.run(`CREATE VIEW ${t} AS SELECT * FROM read_parquet([${input}])`);
    }
    if (published) {
      await setup.run(`CREATE TABLE run(
        run_id varchar, started_at timestamp, finished_at timestamp, status varchar, mode varchar,
        sources json, counts json, deltas json, dead_letters json, limitations json,
        manifest_cid varchar, root_cid varchar, previous_run_id varchar)`);
      const columns = [
        "run_id",
        "started_at",
        "finished_at",
        "status",
        "mode",
        "sources",
        "counts",
        "deltas",
        "dead_letters",
        "limitations",
        "manifest_cid",
        "root_cid",
        "previous_run_id",
      ];
      for (const row of published.history) {
        await setup.run(
          "INSERT INTO run VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          columns.map((key) => {
            const value = row[key] ?? null;
            return value !== null && typeof value === "object"
              ? JSON.stringify(value)
              : (value as DuckDBValue);
          }),
        );
      }
    }
    setup.closeSync();
    return instance;
  };
  (await open()).closeSync(); // fail fast at startup if the dataset cannot be opened
  if (parquet) logger.info({ runId: parquet.runId }, "dataset: parquet views");
  else logger.info({ dbPath }, "dataset: duckdb read-only, opened per query");

  return {
    get origin() {
      return parquet
        ? { kind: "parquet" as const, runId: parquet.runId, dir: parquet.dir }
        : { kind: "duckdb" as const, path: dbPath };
    },
    async refresh() {
      if (!serving || !published) return false;
      const newest = publishedRunIds(serving.pubDirs)[0];
      const historyChanged = mtime(serving.historyPath) !== historyMtime;
      if (newest === seenNewest && !historyChanged) return false;
      seenNewest = newest;
      historyMtime = mtime(serving.historyPath);
      // Integrity-checks the newest publication that passes the gates; keeps serving the current one on failure.
      const next = await publishedSnapshot(datasetDir, serving.pubDirs, serving.historyPath);
      if (!next) return false;
      if (next.runId !== published.runId)
        logger.info(
          { from: published.runId, to: next.runId },
          "dataset: activated newer publication",
        );
      published = next;
      parquet = next;
      version++;
      return true;
    },
    get version() {
      return version;
    },
    async query(sql, params = [], timeoutMs = 10_000) {
      const instance = await open();
      const conn: DuckDBConnection = await instance.connect();
      let timer: NodeJS.Timeout | undefined;
      try {
        const columns = (
          await conn.runAndReadAll(
            `SELECT table_catalog, table_name FROM information_schema.columns WHERE table_schema = 'main'
           AND (column_name IN ('source_system', 'source_record_key', 'source_url')
             OR (table_name = 'contractor_has_license' AND column_name IN ('authority', 'license_number')))
           GROUP BY table_catalog, table_name HAVING count(*) = 3`,
          )
        ).getRowObjectsJson() as { table_catalog: string; table_name: string }[];
        for (const { table_catalog, table_name } of columns) {
          if (!TABLES.includes(table_name as (typeof TABLES)[number])) continue;
          const repair =
            table_name === "contractor_has_license"
              ? legacySourceUrlSql(
                  "case when authority = 'IDFPR' then 'idfpr_roofing' end",
                  "license_number",
                )
              : legacySourceUrlSql();
          await conn.run(`CREATE TEMP VIEW ${table_name} AS SELECT * REPLACE (${repair} AS source_url),
            source_url AS source_url_original FROM "${table_catalog.replace(/"/g, '""')}".main.${table_name}`);
        }
        await lockdown(conn, parquet?.dir);
        const run = conn.runAndReadAll(sql, params).then((r) => r.getRowObjectsJson() as Row[]);
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            conn.interrupt();
            reject(new Error(`query timed out after ${timeoutMs} ms`));
          }, timeoutMs);
        });
        return await Promise.race([run, timeout]);
      } finally {
        clearTimeout(timer);
        conn.closeSync();
        instance.closeSync();
      }
    },
    close() {
      return Promise.resolve();
    },
  };
}
