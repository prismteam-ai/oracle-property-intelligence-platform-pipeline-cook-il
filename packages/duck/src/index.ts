import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from "@duckdb/node-api";

export type Row = Record<string, unknown>;
export type Param = DuckDBValue;

/** Thin wrapper over @duckdb/node-api: one instance, one connection, plain-object rows. */
export class Duck {
  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly conn: DuckDBConnection,
  ) {}

  static async open(path = ":memory:", options: Record<string, string> = {}): Promise<Duck> {
    const instance = await DuckDBInstance.create(path, options);
    const conn = await instance.connect();
    // now()::timestamp is wall time in the session zone; pin it so run/ingest timestamps are UTC on every host
    await conn.run("SET TimeZone = 'UTC'");
    return new Duck(instance, conn);
  }

  /** Run a statement, discard results. */
  async exec(sql: string, params: Param[] = []): Promise<void> {
    await this.conn.run(sql, params);
  }

  /** Run a query, return rows as plain objects (BigInt -> number when safe, DuckDB values -> JS). */
  async query<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T[]> {
    const reader = await this.conn.runAndReadAll(sql, params);
    return reader.getRowObjects().map((r) => normalizeRow(r)) as T[];
  }

  async one<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  async scalar<T = unknown>(sql: string, params: Param[] = []): Promise<T> {
    const row = await this.one(sql, params);
    if (!row) throw new Error(`no rows: ${sql}`);
    return Object.values(row)[0] as T;
  }

  async count(table: string): Promise<number> {
    return Number(await this.scalar(`select count(*) from ${quoteIdent(table)}`));
  }

  async tableExists(table: string): Promise<boolean> {
    const n = await this.scalar<number>(
      "select count(*) from information_schema.tables where table_name = ?",
      [table],
    );
    return Number(n) > 0;
  }

  /** Read a parquet file or glob into rows. */
  readParquet<T extends Row = Row>(path: string, limit?: number): Promise<T[]> {
    return this.query<T>(
      `select * from read_parquet(?)${limit === undefined ? "" : ` limit ${limit}`}`,
      [path],
    );
  }

  close(): void {
    this.conn.closeSync();
    this.instance.closeSync();
  }
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeRow(row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
  return out;
}

function normalizeValue(v: unknown): unknown {
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (v && typeof v === "object" && !Array.isArray(v)) {
    // DuckDBDateValue -> YYYY-MM-DD, DuckDBTimestampValue -> YYYY-MM-DD HH:MM:SS, decimals, lists...
    return (v as { toString(): string }).toString();
  }
  return v;
}
