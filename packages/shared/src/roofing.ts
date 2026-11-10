/** Roofing classifier. The regex sources are reused verbatim in DuckDB SQL (regexp_matches, 'i'). */
export const ROOFING_INCLUDE = String.raw`\bRE-?ROOF|\bROOF(ING)?\b|SHINGLE|TEAR[- ]?OFF`;
export const ROOFING_EXCLUDE = String.raw`ROOF ?DECK|ROOFTOP|GREEN ROOF|SOLAR`;
export const ROOFING_RULE = `work_description ~ /${ROOFING_INCLUDE}/i and not /${ROOFING_EXCLUDE}/i`;

const include = new RegExp(ROOFING_INCLUDE, "i");
const exclude = new RegExp(ROOFING_EXCLUDE, "i");

export interface RoofingMatch {
  is_roofing: boolean;
  roofing_match_rule: string | null;
}

export function classifyRoofing(workDescription: string | null | undefined): RoofingMatch {
  if (!workDescription) return { is_roofing: false, roofing_match_rule: null };
  if (!include.test(workDescription)) return { is_roofing: false, roofing_match_rule: null };
  if (exclude.test(workDescription)) {
    return { is_roofing: false, roofing_match_rule: `excluded:/${ROOFING_EXCLUDE}/i` };
  }
  return { is_roofing: true, roofing_match_rule: ROOFING_RULE };
}

/** Per-source closed status sets. Open = no closed_at and status not in the set. */
export const CLOSED_STATUSES: Record<string, readonly string[]> = {
  cook_assessor_permits: ["CLOSED"],
  chicago_permits: ["COMPLETE", "CANCELLED", "CANCELED", "EXPIRED", "REVOKED", "FINALED"],
};

export function isOpen(
  sourceSystem: string,
  status: string | null | undefined,
  closedAt: string | null | undefined,
): boolean {
  if (closedAt) return false;
  if (!status) return false; // unknown status is never reported as open
  const closed = CLOSED_STATUSES[sourceSystem] ?? [];
  return !closed.includes(status.trim().toUpperCase());
}
