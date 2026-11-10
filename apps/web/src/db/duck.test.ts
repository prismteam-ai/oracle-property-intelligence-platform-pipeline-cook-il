import { DuckDBInstance } from "@duckdb/node-api";
import { mkdtempSync, rmSync } from "node:fs";
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
