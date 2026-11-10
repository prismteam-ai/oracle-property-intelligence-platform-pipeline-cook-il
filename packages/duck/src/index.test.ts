import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Duck, quoteIdent, quoteString } from "./index.js";

let dir: string;
let db: Duck;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "duck-"));
  db = await Duck.open(join(dir, "t.duckdb"));
});
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Duck", () => {
  it("runs SQL with parameters and reads plain rows", async () => {
    await db.exec("create table t(id integer, name varchar, d date, ts timestamp)");
    await db.exec("insert into t values (?, ?, ?, ?)", [
      1,
      "a",
      "2024-01-02",
      "2024-01-02 03:04:05",
    ]);
    const rows = await db.query("select * from t");
    expect(rows).toEqual([{ id: 1, name: "a", d: "2024-01-02", ts: "2024-01-02 03:04:05" }]);
    expect(await db.count("t")).toBe(1);
    expect(await db.scalar("select 42")).toBe(42);
    expect(await db.tableExists("t")).toBe(true);
    expect(await db.tableExists("nope")).toBe(false);
  });
  it("writes and reads parquet", async () => {
    const p = join(dir, "t.parquet");
    await db.exec(`copy t to ${quoteString(p)} (format parquet, compression zstd)`);
    const rows = await db.readParquet(p);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("a");
  });
  it("quotes identifiers and strings", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(quoteString("it's")).toBe("'it''s'");
  });
});
