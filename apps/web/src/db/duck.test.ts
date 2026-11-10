import { DuckDBInstance } from "@duckdb/node-api";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openDataset } from "./duck.js";

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "web-duck-"));
  dbPath = join(dir, "cook_il.duckdb");
  const w = await DuckDBInstance.create(dbPath);
  const c = await w.connect();
  await c.run("create table property(pin14 varchar); insert into property values ('1'), ('2')");
  c.closeSync();
  w.closeSync();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("openDataset", () => {
  it("rejects host file reads from SQL, even through a bare SELECT the guard allows", async () => {
    const ds = await openDataset(dbPath, join(dir, "dataset"));
    for (const sql of [
      "SELECT * FROM read_csv('/etc/passwd')",
      "SELECT * FROM read_text('/proc/self/environ')",
      "SELECT * FROM glob('/**')",
      "SELECT * FROM read_parquet('/etc/*.parquet')",
    ])
      await expect(ds.query(sql), sql).rejects.toThrow(/external access|disabled/i);
    await expect(ds.query("SET enable_external_access = true")).rejects.toThrow(/locked/i);
    expect(await ds.query("select count(*)::integer as n from property")).toEqual([{ n: 2 }]);
  });

  it("parquet views still read their own run directory inside the sandbox", async () => {
    const run = join(dir, "dataset", "r9");
    mkdirSync(join(run, "property"), { recursive: true });
    const w = await DuckDBInstance.create(dbPath);
    const c = await w.connect();
    await c.run(`COPY property TO '${join(run, "property", "data_0.parquet")}' (FORMAT parquet)`);
    c.closeSync();
    w.closeSync();
    const ds = await openDataset(dbPath, join(dir, "dataset"));
    expect(ds.origin.kind).toBe("parquet");
    expect(await ds.query("select count(*)::integer as n from property")).toEqual([{ n: 2 }]);
    await expect(ds.query("SELECT * FROM read_csv('/etc/passwd')")).rejects.toThrow(
      /external access|disabled|allowed/i,
    );
    rmSync(run, { recursive: true, force: true });
  });
  it("opens a fresh read-only instance per query and closes it afterwards", async () => {
    const ds = await openDataset(dbPath, join(dir, "dataset"));
    const closed: DuckDBInstance[] = [];
    const original = DuckDBInstance.create.bind(DuckDBInstance);
    const spy = vi.spyOn(DuckDBInstance, "create").mockImplementation(async (path, options) => {
      const inst = await original(path, options);
      const close = inst.closeSync.bind(inst);
      inst.closeSync = () => {
        closed.push(inst);
        close();
      };
      return inst;
    });
    try {
      const a = await ds.query("select count(*)::integer as n from property");
      const b = await ds.query("select count(*)::integer as n from property");
      expect(a).toEqual([{ n: 2 }]);
      expect(b).toEqual([{ n: 2 }]);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls.every(([, o]) => o?.["access_mode"] === "READ_ONLY")).toBe(true);
      const instances = await Promise.all(
        spy.mock.results.map((r) => r.value as Promise<DuckDBInstance>),
      );
      expect(instances[0]).not.toBe(instances[1]);
      expect(closed).toEqual(instances);
    } finally {
      spy.mockRestore();
    }
  });
});
