import { describe, expect, it } from "vitest";
import { estimateRoofAge } from "./roof-age.js";

const asOf = "2026-11-10";
const closedReroof = (d: string) => ({
  is_roofing: true,
  status_is_open: false,
  closed_at: null,
  issued_at: d,
});

describe("estimateRoofAge", () => {
  it("falls back to year built with low confidence and no synthesized date", () => {
    expect(estimateRoofAge(1990, [], asOf)).toEqual({
      roof_age_years: 36,
      roof_age_basis: "year_built",
      roof_age_confidence: "low",
      roof_age_anchor_date: null,
    });
  });
  it("uses the latest completed reroof permit as a high-confidence anchor", () => {
    const r = estimateRoofAge(1990, [closedReroof("2010-05-01"), closedReroof("2018-11-20")], asOf);
    expect(r).toEqual({
      roof_age_years: 7,
      roof_age_basis: "reroof_permit",
      roof_age_confidence: "high",
      roof_age_anchor_date: "2018-11-20",
    });
  });
  it("prefers closed_at over issued_at and counts whole elapsed years", () => {
    const r = estimateRoofAge(
      null,
      [{ ...closedReroof("2015-01-01"), closed_at: "2016-11-11" }],
      asOf,
    );
    expect(r.roof_age_anchor_date).toBe("2016-11-11");
    expect(r.roof_age_years).toBe(9);
  });
  it("never lets open permits reset age", () => {
    const r = estimateRoofAge(
      1990,
      [{ ...closedReroof("2024-01-01"), status_is_open: true }],
      asOf,
    );
    expect(r.roof_age_basis).toBe("year_built");
    expect(r.roof_age_years).toBe(36);
  });
  it("ignores non-roofing permits and future-dated anchors", () => {
    const r = estimateRoofAge(1990, [{ ...closedReroof("2020-01-01"), is_roofing: false }], asOf);
    expect(r.roof_age_basis).toBe("year_built");
    expect(estimateRoofAge(1990, [closedReroof("2030-01-01")], asOf).roof_age_basis).toBe(
      "year_built",
    );
  });
  it("uses completed new construction as medium when no reroof exists", () => {
    const r = estimateRoofAge(
      1950,
      [{ ...closedReroof("2012-06-30"), is_roofing: false, is_new_construction: true }],
      asOf,
    );
    expect(r.roof_age_confidence).toBe("medium");
    expect(r.roof_age_years).toBe(14);
  });
  it("returns nulls without any evidence or with impossible year built", () => {
    expect(estimateRoofAge(null, [], asOf).roof_age_basis).toBeNull();
    expect(estimateRoofAge(2040, [], asOf).roof_age_basis).toBeNull();
    expect(estimateRoofAge(0, [], asOf).roof_age_basis).toBeNull();
  });
});
