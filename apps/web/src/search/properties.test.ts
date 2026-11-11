import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { makeFixture } from "../../../../fixtures/make-fixture.js";
import { openDataset, type Dataset } from "../db/duck.js";
import { findProperties, getProperty, tableSchema } from "./properties.js";
import { haversineMiles } from "./geo.js";
import { SAMPLE_QUERIES } from "../ui/samples.js";

let ds: Dataset;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "cook-il-test-"));
  const db = join(dir, "cook_il.duckdb");
  await makeFixture(db, join(dir, "publications"));
  ds = await openDataset(db, join(dir, "dataset"));
});
afterAll(async () => ds.close());

const EVANSTON = { lat: 42.0451, lon: -87.6877 };

describe("findProperties", () => {
  it("returns properties within the radius, nearest first, with exact haversine distances", async () => {
    const { properties, total_in_radius } = await findProperties(ds, {
      ...EVANSTON,
      radiusMiles: 2,
      limit: 20,
    });
    expect(properties.length).toBe(20);
    expect(total_in_radius).toBeGreaterThan(20);
    for (const p of properties) {
      expect(p.distance_miles).toBeLessThanOrEqual(2);
      expect(
        Math.abs(
          (p.distance_miles ?? 0) -
            haversineMiles(EVANSTON.lat, EVANSTON.lon, p.lat ?? 0, p.lon ?? 0),
        ),
      ).toBeLessThan(1e-6);
    }
    const d = properties.map((p) => p.distance_miles ?? 0);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });
  it("ranks and applies confidence across the whole radius before a small limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cook-il-global-rank-"));
    const path = join(dir, "cook_il.duckdb");
    await makeFixture(path, join(dir, "publications"));
    const w = await DuckDBInstance.create(path);
    const c = await w.connect();
    await c.run(
      "UPDATE property SET roof_age_years = 20, roof_age_confidence = 'low', roof_age_anchor_date = '2006-01-01'",
    );
    c.closeSync();
    w.closeSync();
    const nds = await openDataset(path, join(dir, "dataset"));
    try {
      const all = (await findProperties(nds, { ...EVANSTON, radiusMiles: 2, limit: 500 }))
        .properties;
      expect(all.length).toBeGreaterThan(2);
      const target = all[all.length - 1]!;
      expect(target.pin14).not.toBe(all[0]!.pin14);
      const writer = await DuckDBInstance.create(path);
      const conn = await writer.connect();
      await conn.run(
        "UPDATE property SET roof_age_years = 100, roof_age_confidence = 'high', roof_age_anchor_date = '1926-01-01' WHERE pin14 = ?",
        [target.pin14],
      );
      await conn.run("UPDATE permit SET open_days = 1");
      await conn.run(
        "UPDATE permit SET pin14 = ?, is_roofing = true, status_is_open = true, open_days = 5000 WHERE permit_id = (SELECT permit_id FROM permit LIMIT 1)",
        [target.pin14],
      );
      conn.closeSync();
      writer.closeSync();
      const input = { ...EVANSTON, radiusMiles: 2, limit: 1 };
      const oldest = await findProperties(nds, { ...input, sort: "roof_age" });
      expect(oldest.properties[0]?.pin14).toBe(target.pin14);
      expect(oldest.total_in_radius).toBeGreaterThanOrEqual(all.length);
      const confident = await findProperties(nds, { ...input, minConfidence: "high" });
      expect(confident.properties[0]?.pin14).toBe(target.pin14);
      expect(confident.total_in_radius).toBe(1);
      const longest = await findProperties(nds, { ...input, sort: "open_days" });
      expect(longest.properties[0]?.pin14).toBe(target.pin14);
      await expect(
        findProperties(nds, { ...input, sort: "made_up" } as unknown as typeof input),
      ).rejects.toThrow();
    } finally {
      await nds.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("matches a brute-force count (geohash prefilter loses nothing)", async () => {
    const all = await ds.query("SELECT pin14, lat, lon FROM property");
    const brute = all.filter(
      (r) => haversineMiles(EVANSTON.lat, EVANSTON.lon, Number(r.lat), Number(r.lon)) <= 1.5,
    ).length;
    const { total_in_radius } = await findProperties(ds, {
      ...EVANSTON,
      radiusMiles: 1.5,
      limit: 1,
    });
    expect(total_in_radius).toBe(brute);
  });
  it("applies roof age and open roofing permit filters", async () => {
    const { properties } = await findProperties(ds, {
      lat: 41.8781,
      lon: -87.6298,
      radiusMiles: 5,
      minRoofAge: 15,
      openRoofingPermitsOnly: true,
      minOpenDays: 365 * 3,
      limit: 50,
    });
    expect(properties.length).toBeGreaterThan(0);
    for (const p of properties) {
      expect(p.roof_age_years).toBeGreaterThanOrEqual(15);
      const open = p.permits.filter(
        (x) => x.is_roofing && x.status_is_open && (x.open_days ?? 0) >= 365 * 3,
      );
      expect(open.length).toBeGreaterThan(0);
      for (const x of open) expect(x.source_url).toMatch(/^https:\/\//);
    }
    const maxOpen = properties.map((p) =>
      Math.max(
        ...p.permits.filter((x) => x.is_roofing && x.status_is_open).map((x) => x.open_days ?? 0),
      ),
    );
    expect([...maxOpen].sort((a, b) => b - a)).toEqual(maxOpen);
  });
  it("excludes unknown roof ages when a threshold is given, honors the minRoofAgeYears alias, counts after filters", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cook-il-nullroof-"));
    const db = join(dir, "cook_il.duckdb");
    await makeFixture(db, join(dir, "publications"));
    const w = await DuckDBInstance.create(db);
    const c = await w.connect();
    await c.run("UPDATE property SET roof_age_years = NULL WHERE hash(pin14) % 3 = 0");
    c.closeSync();
    w.closeSync();
    const nds = await openDataset(db, join(dir, "dataset"));
    try {
      const q = { ...EVANSTON, radiusMiles: 2, limit: 500 };
      const all = await findProperties(nds, q);
      expect(all.properties.some((p) => p.roof_age_years === null)).toBe(true);
      const aged = await findProperties(nds, { ...q, minRoofAge: 15 });
      expect(aged.properties.length).toBeGreaterThan(0);
      expect(aged.total_in_radius).toBe(aged.properties.length);
      expect(aged.total_in_radius).toBeLessThan(all.total_in_radius);
      for (const p of aged.properties) expect(p.roof_age_years).toBeGreaterThanOrEqual(15);
      const alias = await findProperties(nds, { ...q, minRoofAgeYears: 15 });
      expect(alias.total_in_radius).toBe(aged.total_in_radius);
      expect(alias.properties.map((p) => p.pin14)).toEqual(aged.properties.map((p) => p.pin14));
      await expect(
        findProperties(nds, { ...q, minRoofAgeYrs: 15 } as unknown as typeof q),
      ).rejects.toThrow(/minRoofAgeYrs/);
    } finally {
      await nds.close();
    }
  });
  it("getProperty returns permits with contractor and BBB fields", async () => {
    const [row] = await ds.query(
      "SELECT pin14 FROM permit WHERE contractor_id IS NOT NULL AND pin14 IS NOT NULL LIMIT 1",
    );
    const p = await getProperty(ds, String(row?.pin14));
    expect(p?.permits.some((x) => x.contractor !== null)).toBe(true);
    expect(await getProperty(ds, "00000000000000")).toBeNull();
  });
  it("tableSchema lists the contract tables", async () => {
    const names = (await tableSchema(ds)).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["property", "permit", "contractor", "run"]));
  });
  it("query timeout interrupts long queries", async () => {
    await expect(
      ds.query("SELECT count(*) FROM range(100000000) a, range(100000) b", [], 300),
    ).rejects.toThrow(/timed out/);
  });
});

describe("sample queries", () => {
  it("every SQL console sample returns rows against the fixture (no hand-typed geohash prefixes)", async () => {
    for (const s of SAMPLE_QUERIES) {
      expect(s.sql).not.toMatch(/geohash/);
      expect((await ds.query(s.sql)).length, s.title).toBeGreaterThan(0);
    }
  });
});
