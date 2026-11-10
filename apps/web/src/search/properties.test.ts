import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFixture } from "../../../../fixtures/make-fixture.js";
import { openDataset, type Dataset } from "../db/duck.js";
import { findProperties, getProperty, tableSchema } from "./properties.js";
import { haversineMiles } from "./geo.js";

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
