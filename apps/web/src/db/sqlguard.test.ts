import { describe, expect, it } from "vitest";
import { guardSql } from "./sqlguard.js";

describe("guardSql", () => {
  it("wraps SELECT and enforces limit cap", () => {
    expect(guardSql("select 1", 5000)).toBe("SELECT * FROM (select 1) AS _q LIMIT 1000");
    expect(guardSql("SELECT 1;", 10)).toBe("SELECT * FROM (SELECT 1) AS _q LIMIT 10");
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
});
