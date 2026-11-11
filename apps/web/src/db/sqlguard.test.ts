import { DuckDBInstance } from "@duckdb/node-api";
import { describe, expect, it } from "vitest";
import { guardSql } from "./sqlguard.js";
import { SAMPLE_QUERIES } from "../ui/samples.js";

describe("guardSql", () => {
  it("wraps SELECT and enforces limit cap", () => {
    expect(guardSql("select 1", 5000)).toBe("SELECT * FROM (\nselect 1\n) AS _q LIMIT 1000");
    expect(guardSql("SELECT 1;", 10)).toBe("SELECT * FROM (\nSELECT 1\n) AS _q LIMIT 10");
  });
  it("accepts WITH", () => {
    expect(guardSql("WITH a AS (SELECT 1) SELECT * FROM a")).toContain("WITH a AS");
  });
  it("rejects writes, multiple statements and non-select", () => {
    expect(() => guardSql("DROP TABLE property")).toThrow();
    expect(() => guardSql("SELECT 1; DROP TABLE property")).toThrow();
    expect(() =>
      guardSql("SELECT 1 FROM x WHERE 1=1 UNION ALL SELECT 2 FROM (DELETE FROM y RETURNING 1)"),
    ).toThrow();
    expect(() => guardSql("PRAGMA database_list")).toThrow();
    expect(() => guardSql("")).toThrow();
  });
  it("ignores keywords inside string literals", () => {
    expect(guardSql("SELECT 'drop table' AS s")).toContain("'drop table'");
  });
  it("rejects input that closes the LIMIT wrapper early", () => {
    expect(() => guardSql("select * from range(1500)) --")).toThrow(/parentheses/);
    expect(() => guardSql("select * from range(1500)) /*")).toThrow();
    expect(() => guardSql("select * from range(1500) /* x")).toThrow(/comment/);
    expect(() => guardSql("select * from range(1500)) /* x */")).toThrow(/parentheses/);
    expect(() => guardSql("select 1) union all (select * from range(5000)")).toThrow(/parentheses/);
    expect(() => guardSql("select (1")).toThrow(/parentheses/);
  });
  it("strips comments before checking, so they cannot hide statements or keywords", () => {
    const out = guardSql("select 1 -- ; drop table property\n/* ; DELETE */ as n -- done");
    expect(out).toBe("SELECT * FROM (\nselect 1 \n  as n\n) AS _q LIMIT 1000");
    expect(guardSql("-- note\n/* x */ select 1")).toContain("select 1");
    expect(() => guardSql("select 1 /* x */; drop table property")).toThrow(/one statement/);
    expect(() => guardSql("select 1 --x\n; drop table property")).toThrow(/one statement/);
    expect(() => guardSql("/* select */ drop table property")).toThrow(/SELECT/);
    expect(() => guardSql("select 1 as a, /**/ (delete from x returning 1)")).toThrow(/forbidden/);
  });
  it("keeps comment markers, parentheses and semicolons inside quotes", () => {
    const sql = `select '-- /* ) ; it''s' as s, "a)--b" as "c;/*"`;
    expect(guardSql(`${sql};`)).toBe(`SELECT * FROM (\n${sql}\n) AS _q LIMIT 1000`);
    expect(() => guardSql("select 'abc")).toThrow(/unterminated/);
    expect(() => guardSql('select "abc')).toThrow(/unterminated/);
  });
  it("rejects quoting it does not model", () => {
    expect(() => guardSql("select E'\\'' from range(1500)) --'")).toThrow(/backslash/);
    expect(() => guardSql("select $$'$$ from range(1500)) --'")).toThrow(/dollar/);
    expect(guardSql("select e'a', DATE'2020-01-01', 'a\\b'")).toContain("'a\\b'");
  });
  it("accepts every sample query", () => {
    for (const { title, sql } of SAMPLE_QUERIES) expect(() => guardSql(sql), title).not.toThrow();
  });
  it("holds the row cap when executed by DuckDB", async () => {
    const db = await DuckDBInstance.create(":memory:");
    const conn = await db.connect();
    const rows = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();
    try {
      expect(await rows(guardSql("select * from range(1500)", 5))).toHaveLength(5);
      expect(await rows(guardSql("select * from range(1500)", 5000))).toHaveLength(1000);
      expect(await rows(guardSql("select * from range(1500) -- trailing comment", 5))).toHaveLength(
        5,
      );
      expect(
        await rows(guardSql(`select ')' as a, '--' as b, ';' as c, "x)" from (select 1 as "x)")`)),
      ).toEqual([{ a: ")", b: "--", c: ";", "x)": 1 }]);
      expect(() => guardSql("select * from range(1500)) --", 5)).toThrow();
    } finally {
      conn.closeSync();
      db.closeSync();
    }
  });
});
