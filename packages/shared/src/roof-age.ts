import type { RoofAgeBasis, RoofAgeConfidence } from "./schemas.js";

/** Permit evidence relevant to roof age, already classified. */
export interface RoofPermitEvidence {
  is_roofing: boolean;
  is_new_construction?: boolean;
  status_is_open: boolean;
  /** terminal date: closed_at when present, else issued_at. YYYY-MM-DD */
  closed_at: string | null;
  issued_at: string | null;
}

export interface RoofAgeEstimate {
  roof_age_years: number | null;
  roof_age_basis: RoofAgeBasis | null;
  roof_age_confidence: RoofAgeConfidence | null;
  roof_age_anchor_date: string | null;
}

const NONE: RoofAgeEstimate = {
  roof_age_years: null,
  roof_age_basis: null,
  roof_age_confidence: null,
  roof_age_anchor_date: null,
};

function anchorDate(p: RoofPermitEvidence): string | null {
  return p.closed_at ?? p.issued_at;
}

function wholeYears(anchor: string, asOf: string): number {
  const a = new Date(anchor + "T00:00:00Z");
  const b = new Date(asOf + "T00:00:00Z");
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (
    b.getUTCMonth() < a.getUTCMonth() ||
    (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())
  ) {
    y -= 1;
  }
  return y;
}

/**
 * Kit contract: latest completed reroof permit terminal date -> high; completed new-construction
 * permit -> medium; year built -> low. Open permits never reset age. Dates are never synthesized:
 * a year-built anchor has no anchor date and calendar-year precision. Future-dated anchors are
 * ignored as impossible.
 */
export function estimateRoofAge(
  yearBuilt: number | null,
  permits: readonly RoofPermitEvidence[],
  asOf: string,
): RoofAgeEstimate {
  const asOfYear = Number(asOf.slice(0, 4));
  const completed = permits.filter((p) => !p.status_is_open && anchorDate(p) !== null);
  const pick = (pred: (p: RoofPermitEvidence) => boolean): string | null =>
    completed
      .filter(pred)
      .map(anchorDate)
      .filter((d): d is string => d !== null && d <= asOf)
      .sort()
      .at(-1) ?? null;

  const reroof = pick((p) => p.is_roofing);
  if (reroof) {
    return {
      roof_age_years: wholeYears(reroof, asOf),
      roof_age_basis: "reroof_permit",
      roof_age_confidence: "high",
      roof_age_anchor_date: reroof,
    };
  }
  const build = pick((p) => p.is_new_construction === true);
  if (build) {
    return {
      roof_age_years: wholeYears(build, asOf),
      roof_age_basis: "new_construction_permit",
      roof_age_confidence: "medium",
      roof_age_anchor_date: build,
    };
  }
  if (yearBuilt !== null && yearBuilt >= 1800 && yearBuilt <= asOfYear) {
    return {
      roof_age_years: asOfYear - yearBuilt,
      roof_age_basis: "year_built",
      roof_age_confidence: "low",
      roof_age_anchor_date: null,
    };
  }
  return NONE;
}
