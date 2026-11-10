import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from "@duckdb/node-api";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { publishedSnapshot } from "./snapshot.js";
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
  const published = serving
    ? await publishedSnapshot(datasetDir, serving.pubDirs, serving.historyPath)
    : null;
  // Production serving with publications must never fall through to the writer's DB.
  if (serving && !published) throw new Error("no verified published snapshot available locally");
  const parquet = published ?? newerParquetRun(dbPath, datasetDir);
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
    origin: parquet
      ? { kind: "parquet", runId: parquet.runId, dir: parquet.dir }
      : { kind: "duckdb", path: dbPath },
    async query(sql, params = [], timeoutMs = 10_000) {
      const instance = await open();
      const conn: DuckDBConnection = await instance.connect();
      let timer: NodeJS.Timeout | undefined;
      try {
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
