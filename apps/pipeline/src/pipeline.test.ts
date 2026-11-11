import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Duck } from "@cook/duck";
import { estimateRoofAge, geohash6 } from "@cook/shared";
import pino from "pino";
import { rawDir } from "./fetch.js";
import { finishRun, startRun } from "./run.js";
import { canonicalize } from "./socrata.js";
import { findSource } from "./sources.js";
import { readWatermark, stageAll } from "./stage.js";
import { GEOHASH_MACROS, transform } from "./transform.js";

const log = pino({ level: "silent" });
const AS_OF = "2026-11-10";
const P1 = "01011000040000";
const P2 = "17052170040000";

function writeBatch(
  dataDir: string,
  system: string,
  batch: string,
  rows: Record<string, unknown>[],
  updatedAt = "2026-11-01T00:00:00.000Z",
) {
  const s = findSource(system);
  const dir = rawDir(dataDir, system, batch);
  mkdirSync(dir, { recursive: true });
  const lines = rows.map((r, i) =>
    JSON.stringify(canonicalize(s, { ":id": `row-${batch}-${i}`, ":updated_at": updatedAt, ...r })),
  );
  writeFileSync(join(dir, "page-00000.ndjson"), lines.join("\n") + "\n");
  writeFileSync(
    join(dir, "_done.json"),
    JSON.stringify({
      batch_id: batch,
      source_system: system,
      count: rows.length,
      pages: 1,
      rows_fetched: rows.length,
      max_updated_at: updatedAt,
      where: null,
      started_at: updatedAt,
      finished_at: updatedAt,
      seconds: 0,
    }),
  );
}

function seed(dataDir: string) {
  writeBatch(dataDir, "cook_parcels", "full", [
    {
      pin: P1,
      pin10: "0101100004",
      year: "2026",
      class: "203",
      township_name: "Barrington",
      cook_municipality_name: "VILLAGE OF BARRINGTON",
      zip_code: "60010",
      lat: "42.15",
      lon: "-88.13",
    },
    {
      pin: P2,
      pin10: "1705217004",
      year: "2026",
      class: "211",
      township_name: "North Chicago",
      cook_municipality_name: "CITY OF CHICAGO",
      zip_code: "60642",
      lat: "41.90",
      lon: "-87.65",
    },
  ]);
  writeBatch(dataDir, "cook_characteristics", "full", [
    {
      pin: P1,
      year: "2026.0",
      class: "203",
      char_yrblt: "1990.0",
      char_roof_cnst: "Shingle + Asphalt",
    },
    { pin: P2, year: "2026.0", class: "211", char_yrblt: "1925.0", char_roof_cnst: "" },
  ]);
  writeBatch(dataDir, "cook_addresses", "full", [
    {
      pin: P1,
      pin10: "0101100004",
      year: "2026",
      prop_address_full: "1 MAIN ST",
      prop_address_city_name: "BARRINGTON",
      prop_address_zipcode_1: "60010",
      mail_address_name: "SNOWBIRD LLC",
      mail_address_full: "9 BEACH RD",
      mail_address_city_name: "NAPLES",
      mail_address_state: "FL",
      mail_address_zipcode_1: "34102",
    },
    {
      pin: P2,
      pin10: "1705217004",
      year: "2026",
      prop_address_full: "1412 N KINGSBURY ST",
      prop_address_city_name: "CHICAGO",
      prop_address_zipcode_1: "60642",
      mail_address_name: "BIG DEAHL",
      mail_address_full: "1450 N DAYTON ST",
      mail_address_city_name: "CHICAGO",
      mail_address_state: "IL",
      mail_address_zipcode_1: "60642",
    },
  ]);
  writeBatch(dataDir, "cook_sales", "full", [
    {
      pin: P1,
      year: "2010",
      sale_date: "2010-02-01T00:00:00.000",
      sale_price: "200000",
      doc_no: "1",
      deed_type: "Warranty",
      buyer_name: "A",
      seller_name: "B",
      is_multisale: "false",
      num_parcels_sale: "1",
      row_id: "s1",
    },
    {
      pin: P1,
      year: "2015",
      sale_date: "2015-03-01T00:00:00.000",
      sale_price: "250000",
      doc_no: "2",
      deed_type: "Warranty",
      buyer_name: "C",
      seller_name: "A",
      is_multisale: "false",
      num_parcels_sale: "1",
      row_id: "s2",
    },
  ]);
  writeBatch(dataDir, "cook_assessor_permits", "full", [
    {
      pin: P1,
      year: "2018.0",
      permit_number: "p1",
      date_issued: "2018-06-01T00:00:00.000",
      status: "CLOSED",
      municipality: "VILLAGE OF BARRINGTON",
      applicant_name: "Team Roofing Co.",
      work_description: "TEAR OFF AND REROOF",
      row_id: "a1",
      property_address: "1 MAIN ST",
    },
    {
      pin: P1,
      year: "2024.0",
      permit_number: "p2",
      date_issued: "2024-09-01T00:00:00.000",
      status: "PENDING",
      municipality: "VILLAGE OF BARRINGTON",
      applicant_name: "OWNER",
      work_description: "NEW ROOF",
      row_id: "a2",
    },
    {
      pin: P2,
      year: "2020.0",
      permit_number: "p3",
      date_issued: "2020-01-01T00:00:00.000",
      status: "CLOSED",
      municipality: "CITY OF CHICAGO",
      applicant_name: "X",
      work_description: "FENCE",
      row_id: "a3",
    },
    {
      pin: P2,
      year: "2021.0",
      permit_number: "p4",
      date_issued: "2021-01-01T00:00:00.000",
      status: "CLOSED",
      municipality: "CITY OF CHICAGO",
      applicant_name: "SUNNY SIDE UP",
      work_description: "ROOF DECK",
      row_id: "a4",
    },
  ]);
  writeBatch(dataDir, "chicago_permits", "full", [
    {
      id: "c1",
      permit_: "100000001",
      permit_status: "COMPLETE",
      permit_type: "PERMIT - EASY PERMIT PROCESS",
      application_start_date: "2012-04-01T00:00:00.000",
      issue_date: "2012-05-05T00:00:00.000",
      street_number: "1412",
      street_direction: "N",
      street_name: "KINGSBURY ST",
      work_description: "TEAR-OFF AND RE-ROOF",
      pin_list: "0000000000 | 1705217004",
      contact_1_type: "OWNER",
      contact_1_name: "BIG DEAHL",
      contact_2_type: "CONTRACTOR-GENERAL CONTRACTOR",
      contact_2_name: "A & B Roofing, Inc.",
    },
    {
      id: "c2",
      permit_: "100000002",
      permit_status: "ACTIVE",
      permit_type: "PERMIT - RENOVATION/ALTERATION",
      application_start_date: "2020-01-01T00:00:00.000",
      issue_date: "2020-02-01T00:00:00.000",
      street_number: "1412",
      street_direction: "N",
      street_name: "KINGSBURY ST",
      work_description: "replace shingles",
      pin_list: "1705217004",
      latitude: "41.901",
      longitude: "-87.651",
      contact_1_type: "CONTRACTOR-GENERAL CONTRACTOR",
      contact_1_name: "Sunny Roofs",
    },
    {
      id: "c3",
      permit_: "100000003",
      permit_type: "PERMIT - SIGNS",
      issue_date: "2001-01-01T00:00:00.000",
      work_description: "ROOFTOP SIGN",
      latitude: "41.9",
      longitude: "-87.6",
    },
  ]);
  writeBatch(dataDir, "idfpr_roofing", "full", [
    {
      license_type: "ROOFING CONTRACTOR",
      license_number: "104000001",
      license_status: "ACTIVE",
      business_name: "TEAM ROOFING CO",
      city: "CHICAGO",
      state: "IL",
      county: "COOK",
      ever_disciplined: "N",
      expiration_date: "06/30/2027",
    },
    {
      license_type: "ROOFING CONTRACTOR",
      license_number: "104000002",
      license_status: "ACTIVE",
      business_name: "A & B ROOFING",
      city: "CHICAGO",
      state: "IL",
      county: "COOK",
      ever_disciplined: "Y",
      expiration_date: "06/30/2027",
    },
    {
      license_type: "ROOFING CONTRACTOR",
      license_number: "104000003",
      license_status: "NOT RENEWED",
      business_name: "SUNSHINE ENTERPRISES LLC",
      businessdba: "Sunny Roofs",
      city: "SKOKIE",
      state: "IL",
      county: "COOK",
      ever_disciplined: "N",
      expiration_date: "06/30/2020",
    },
    { license_type: "ROOFING CONTRACTOR", license_number: "", business_name: "NO NUMBER CO" },
  ]);
  writeBatch(dataDir, "chicago_business_licenses", "full", [
    {
      id: "b1-2026",
      license_id: "1",
      legal_name: "ACME INC",
      doing_business_as_name: "ACME",
      address: "1 W LAKE ST",
      city: "CHICAGO",
      state: "IL",
      zip_code: "60601",
      license_description: "Limited Business License",
      license_status: "AAI",
      date_issued: "2026-01-01T00:00:00.000",
      expiration_date: "2028-01-01T00:00:00.000",
      latitude: "41.885",
      longitude: "-87.63",
    },
  ]);
}

let dataDir: string;
let db: Duck;
beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "pipe-"));
  seed(dataDir);
  db = await Duck.open(join(dataDir, "t.duckdb"));
});
afterAll(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("stage + transform (integration)", () => {
  it("stages every completed batch once and records watermarks", async () => {
    const r1 = await stageAll(db, dataDir, "run1", log);
    expect(r1.find((x) => x.source_system === "idfpr_roofing")?.rows_total).toBe(4);
    expect(await readWatermark(db, "cook_parcels")).toBe("2026-11-01T00:00:00.000Z");
    const r2 = await stageAll(db, dataDir, "run1b", log);
    expect(r2.every((x) => x.batches_staged.length === 0)).toBe(true);
    expect(
      await db.scalar("select count(*) from raw_idfpr_roofing where license_number is null"),
    ).toBe(1);
  });

  it("builds the contract tables with joins, geocoding, roofing and contractor matching", async () => {
    const t = await transform(db, { dataDir, runId: "run1", log, asOf: AS_OF });
    expect(t.counts).toEqual({
      property: 2,
      permit: 7,
      contractor: 4,
      business: 1,
      sale: 2,
      property_improvement_has_contractor: 3,
      contractor_has_license: 3,
    });
    expect(t.deltas["property"]).toEqual({ inserted: 2, updated: 0, unchanged: 0 });

    const p1 = (await db.one(`select * from property where pin14 = '${P1}'`))!;
    expect(p1["year_built"]).toBe(1990);
    expect(p1["owner_name"]).toBe("SNOWBIRD LLC");
    expect(p1["is_out_of_area"]).toBe(true);
    expect(p1["last_sale_date"]).toBe("2015-03-01");
    expect(p1["last_sale_price"]).toBe(250000);
    expect(p1["geohash6"]).toBe(geohash6(42.15, -88.13));
    expect(p1["source_url"]).toBe(
      `https://datacatalog.cookcountyil.gov/resource/pabr-t5kh.json?pin=${P1}&year=2026`,
    );
    // SQL mirrors the TS estimator: closed reroof 2018 wins; the 2024 open permit does not reset.
    const ts = estimateRoofAge(
      1990,
      [
        { is_roofing: true, status_is_open: false, closed_at: null, issued_at: "2018-06-01" },
        { is_roofing: true, status_is_open: true, closed_at: null, issued_at: "2024-09-01" },
      ],
      AS_OF,
    );
    expect(p1["roof_age_basis"]).toBe(ts.roof_age_basis);
    expect(p1["roof_age_confidence"]).toBe("high");
    expect(p1["roof_age_anchor_date"]).toBe("2018-06-01");
    expect(p1["roof_age_years"]).toBe(ts.roof_age_years);

    const p2 = (await db.one(`select * from property where pin14 = '${P2}'`))!;
    expect(p2["is_out_of_area"]).toBe(false);
    expect(p2["roof_age_anchor_date"]).toBe("2012-05-05"); // Chicago COMPLETE reroof via pin10
    expect(p2["roof_age_years"]).toBe(14);

    const permits = await db.query<Record<string, unknown>>(
      "select * from permit order by permit_id",
    );
    const byId = Object.fromEntries(permits.map((p) => [p["permit_id"] as string, p]));
    const c1 = byId["chicago_permits:100000001"]!;
    expect(c1["pin14"]).toBe(P2);
    expect(c1["source_url"]).toBe("https://data.cityofchicago.org/resource/ydr8-5enu.json?id=c1");
    expect(c1["lat"]).toBe(41.9); // geocoded from parcel centroid
    expect(c1["is_roofing"]).toBe(true);
    expect(c1["status_is_open"]).toBe(false);
    expect(c1["contractor_name"]).toBe("A & B Roofing, Inc.");
    expect(c1["contractor_id"]).toBe("idfpr:104000002");
    expect(c1["contractor_match_tier"]).toBe("suffix_stripped");
    const c2 = byId["chicago_permits:100000002"]!;
    expect(c2["status_is_open"]).toBe(true);
    expect(c2["open_days"]).toBe(2474);
    expect(c2["contractor_id"]).toBe("idfpr:104000003");
    expect(c2["contractor_match_tier"]).toBe("dba");
    expect(byId["chicago_permits:100000003"]!["is_roofing"]).toBe(false);
    expect(byId["chicago_permits:100000003"]!["status_is_open"]).toBe(false);
    const a1 = byId["cook_assessor_permits:a1"]!;
    expect(a1["contractor_id"]).toBe("idfpr:104000001");
    expect(a1["source_url"]).toBe(
      "https://datacatalog.cookcountyil.gov/resource/6yjf-dfxs.json?row_id=a1",
    );
    expect(a1["contractor_match_tier"]).toBe("exact_normalized");
    expect(a1["lat"]).toBe(42.15);
    expect(a1["geohash6"]).toBe(geohash6(42.15, -88.13));
    const a4 = byId["cook_assessor_permits:a4"]!;
    expect(a4["is_roofing"]).toBe(false);
    expect(a4["roofing_match_rule"]).toMatch(/^excluded:/);

    const ids = (
      await db.query<{ contractor_id: string }>("select contractor_id from contractor order by 1")
    ).map((r) => r.contractor_id);
    expect(ids).toContain("idfpr:104000001");
    expect(ids.some((i) => i.startsWith("idfpr:row:"))).toBe(true);
    const fallback = (await db.one(
      "select source_url, source_record_key from contractor where license_number = ''",
    ))!;
    expect(new URL(String(fallback["source_url"])).searchParams.get("$where")).toBe(
      `:id='${String(fallback["source_record_key"])}'`,
    );
    expect(await db.scalar("select source_url from sale where sale_id = 'cook_sales:s1'")).toBe(
      "https://datacatalog.cookcountyil.gov/resource/wvhk-k5uv.json?row_id=s1",
    );
    const business = (await db.one("select source_url, source_record_key from business"))!;
    expect(new URL(String(business["source_url"])).searchParams.get("id")).toBe(
      business["source_record_key"],
    );
    expect(await db.scalar("select bbb_state from contractor limit 1")).toBe("unknown");

    const edges = await db.query<Record<string, unknown>>(
      "select * from property_improvement_has_contractor order by permit_id",
    );
    expect(
      edges.map((e) => [
        e["permit_id"],
        e["match_tier"],
        e["match_confidence"],
        e["matched_name_key"],
      ]),
    ).toEqual([
      ["chicago_permits:100000001", "suffix_stripped", 0.7, "A AND B ROOFING"],
      ["chicago_permits:100000002", "dba", 0.7, "SUNNY ROOFS"],
      ["cook_assessor_permits:a1", "exact_normalized", 0.8, "TEAM ROOFING CO"],
    ]);
    const lic = await db.query<Record<string, unknown>>(
      "select * from contractor_has_license order by license_number",
    );
    expect(lic.map((l) => l["license_number"])).toEqual(["104000001", "104000002", "104000003"]);
    expect(lic[0]).toMatchObject({
      contractor_id: "idfpr:104000001",
      authority: "IDFPR",
      license_status: "ACTIVE",
      source_url: "https://data.illinois.gov/resource/pzzh-kp68.json?license_number=104000001",
    });

    const dirs = readdirSync(join(dataDir, "dataset", "run1"));
    expect(dirs.sort()).toEqual([
      "business",
      "contractor",
      "contractor_has_license",
      "permit",
      "property",
      "property_improvement_has_contractor",
      "sale",
      "source_watermark",
    ]);
    const parquet = await db.query(
      `select count(*) n from read_parquet('${join(dataDir, "dataset", "run1", "permit", "*.parquet")}')`,
    );
    expect(parquet[0]?.["n"]).toBe(7);
  });

  it("is idempotent: a rerun without changes yields zero deltas and keeps provenance", async () => {
    const t = await transform(db, { dataDir, runId: "run2", log, asOf: AS_OF });
    for (const d of Object.values(t.deltas)) expect(d.inserted + d.updated).toBe(0);
    expect(await db.scalar("select count(distinct run_id) from permit")).toBe(1);
    expect(await db.scalar("select run_id from property limit 1")).toBe("run1");
  });

  it("applies an incremental batch as an update delta and advances the watermark", async () => {
    writeBatch(
      dataDir,
      "cook_assessor_permits",
      "inc-run3",
      [
        {
          pin: P1,
          year: "2024.0",
          permit_number: "p2",
          date_issued: "2024-09-01T00:00:00.000",
          status: "CLOSED",
          municipality: "VILLAGE OF BARRINGTON",
          applicant_name: "OWNER",
          work_description: "NEW ROOF",
          row_id: "a2",
        },
      ],
      "2026-11-05T00:00:00.000Z",
    );
    const st = await stageAll(db, dataDir, "run3", log);
    expect(st.find((x) => x.source_system === "cook_assessor_permits")?.batches_staged).toEqual([
      "inc-run3",
    ]);
    expect(await readWatermark(db, "cook_assessor_permits")).toBe("2026-11-05T00:00:00.000Z");
    const t = await transform(db, { dataDir, runId: "run3", log, asOf: AS_OF });
    expect(t.deltas["permit"]).toEqual({ inserted: 0, updated: 1, unchanged: 6 });
    expect(t.deltas["property"]).toEqual({ inserted: 0, updated: 1, unchanged: 1 });
    const p1 = (await db.one(
      `select roof_age_anchor_date, run_id from property where pin14 = '${P1}'`,
    ))!;
    expect(p1["roof_age_anchor_date"]).toBe("2024-09-01");
    expect(p1["run_id"]).toBe("run3");
  });

  it("computes geohash6 in SQL exactly like the TS reference", async () => {
    for (const stmt of GEOHASH_MACROS.split(";")
      .map((x) => x.trim())
      .filter(Boolean))
      await db.exec(stmt);
    const pts = Array.from({ length: 300 }, (_, i) => ({
      lat: 41.4 + (((i * 7919) % 1000) / 1000) * 0.8,
      lon: -88.3 + (((i * 104729) % 1000) / 1000) * 0.9,
    }));
    pts.push(
      { lat: 90, lon: 180 },
      { lat: -90, lon: -180 },
      { lat: 0, lon: 0 },
      { lat: 42.6, lon: -5.6 },
    );
    for (const { lat, lon } of pts) {
      expect(await db.scalar(`select geohash6(${lat}, ${lon})`)).toBe(geohash6(lat, lon));
    }
    expect(await db.scalar("select geohash6(null, 1)")).toBeNull();
  });

  it("records a run row with counts, deltas and limitations", async () => {
    const ctx = {
      db,
      dataDir,
      auth: { keyId: "k", keySecret: "s" },
      log,
      runId: "run4",
      incremental: true,
    };
    await startRun(ctx);
    const t = await transform(db, { dataDir, runId: "run4", log, asOf: AS_OF });
    const run = await finishRun(ctx, "ok", { transform: t });
    expect(run.previous_run_id).toBeNull();
    expect(run.counts["permit"]).toBe(7);
    expect(run.limitations.length).toBeGreaterThan(3);
    await startRun({ ...ctx, runId: "run5" });
    expect(await db.scalar("select status from run where run_id = 'run4'")).toBe("ok");
    await startRun({ ...ctx, runId: "run6" });
    expect(await db.scalar("select status from run where run_id = 'run5'")).toBe("failed");
    const row = (await db.one("select status, mode, counts from run where run_id = 'run4'"))!;
    expect(row["status"]).toBe("ok");
    expect(row["mode"]).toBe("incremental");
  });
});
