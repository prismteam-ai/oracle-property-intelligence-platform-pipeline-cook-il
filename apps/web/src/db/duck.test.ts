import { DuckDBInstance } from "@duckdb/node-api";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openDataset } from "./duck.js";
import { SOURCES, sourceUrl } from "@cook/shared";

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
  it("repairs legacy provenance for SQL projections without changing stored bytes or custom URLs", async () => {
    const path = join(dir, "legacy.duckdb");
    const writer = await DuckDBInstance.create(path);
    const conn = await writer.connect();
    await conn.run(
      "create table property(source_system varchar, source_record_key varchar, source_url varchar)",
    );
    const cases = SOURCES.map((s) => {
      const key = s.keyFields.length === 2 ? "10253260360000|2026" : "A & B+'雪?/#%=x";
      return {
        system: s.system,
        key,
        original: `${sourceUrl(s)}?${key}`,
        params: Object.fromEntries(s.keyFields.map((f, i) => [f, key.split("|")[i]])),
      };
    });
    for (const { system, key, original } of cases)
      await conn.run("insert into property values (?, ?, ?)", [system, key, original]);
    const unchanged = [
      ["unknown", "123", "https://example.com/?123"],
      ["cook_parcels", "10253260360000|2026", "https://example.com/custom"],
      ["cook_parcels", "10253260360000", `${sourceUrl(SOURCES[0]!)}?10253260360000`],
      [
        "idfpr_roofing",
        "row-ambiguous",
        "https://data.illinois.gov/resource/pzzh-kp68?row-ambiguous",
      ],
      [
        "chicago_permits",
        "3143020",
        "https://data.cityofchicago.org/resource/ydr8-5enu.json?id=3143020",
      ],
    ];
    for (const row of unchanged) await conn.run("insert into property values (?, ?, ?)", row);
    await conn.run(
      "create table contractor_has_license(authority varchar, license_number varchar, source_url varchar)",
    );
    await conn.run(
      "insert into contractor_has_license values ('IDFPR', '104000001', 'https://data.illinois.gov/resource/pzzh-kp68?104000001')",
    );
    conn.closeSync();
    writer.closeSync();
    const bytes = readFileSync(path);
    const ds = await openDataset(path, join(dir, "absent"));
    try {
      const rows = await ds.query(
        "select source_url as citation, source_url_original from property",
      );
      for (const [i, expected] of cases.entries()) {
        const row = rows[i]!;
        expect(row.source_url_original).toBe(expected.original);
        expect(Object.fromEntries(new URL(String(row.citation)).searchParams)).toEqual(
          expected.params,
        );
        expect([...new URL(expected.original).searchParams.keys()]).not.toEqual(
          Object.keys(expected.params),
        );
      }
      expect(rows.slice(cases.length).map((r) => r.citation)).toEqual(unchanged.map((r) => r[2]));
      expect(
        await ds.query("select source_url, source_url_original from contractor_has_license"),
      ).toEqual([
        {
          source_url: "https://data.illinois.gov/resource/pzzh-kp68.json?license_number=104000001",
          source_url_original: "https://data.illinois.gov/resource/pzzh-kp68?104000001",
        },
      ]);
      expect(readFileSync(path)).toEqual(bytes);
    } finally {
      await ds.close();
    }
  });
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
