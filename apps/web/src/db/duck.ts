import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../logger.js';

export type Row = Record<string, unknown>;
export const TABLES = [
  'property',
  'permit',
  'contractor',
  'business',
  'sale',
  'run',
  'source_watermark',
] as const;

export interface Dataset {
  /** Where rows come from: the duckdb file or a parquet run directory. */
  readonly origin: { kind: 'duckdb'; path: string } | { kind: 'parquet'; runId: string; dir: string };
  query(sql: string, params?: DuckDBValue[], timeoutMs?: number): Promise<Row[]>;
  close(): Promise<void>;
}

/** Newest `<datasetDir>/<run_id>` directory that is newer than the duckdb file, if any. */
export function newerParquetRun(dbPath: string, datasetDir: string): { runId: string; dir: string } | null {
  if (!existsSync(datasetDir)) return null;
  const dbMtime = existsSync(dbPath) ? statSync(dbPath).mtimeMs : 0;
  const runs = readdirSync(datasetDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(datasetDir, d.name, 'property')))
    .map((d) => ({
      runId: d.name,
      dir: join(datasetDir, d.name),
      mtime: statSync(join(datasetDir, d.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  const newest = runs[0];
  return newest && newest.mtime > dbMtime ? { runId: newest.runId, dir: newest.dir } : null;
}

export async function openDataset(dbPath: string, datasetDir: string): Promise<Dataset> {
  const parquet = newerParquetRun(dbPath, datasetDir);
  const instance = parquet
    ? await DuckDBInstance.create(':memory:')
    : await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
  const setup = await instance.connect();
  if (parquet) {
    for (const t of TABLES) {
      const dir = join(parquet.dir, t);
      if (!existsSync(dir)) continue;
      const glob = resolve(dir, '*.parquet').replace(/'/g, "''");
      await setup.run(`CREATE VIEW ${t} AS SELECT * FROM read_parquet('${glob}')`);
    }
    logger.info({ runId: parquet.runId }, 'dataset: parquet views');
  } else {
    logger.info({ dbPath }, 'dataset: duckdb read-only');
  }
  setup.closeSync();

  return {
    origin: parquet ? { kind: 'parquet', ...parquet } : { kind: 'duckdb', path: dbPath },
    async query(sql, params = [], timeoutMs = 10_000) {
      const conn: DuckDBConnection = await instance.connect();
      let timer: NodeJS.Timeout | undefined;
      try {
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
      }
    },
    async close() {
      instance.closeSync();
    },
  };
}
