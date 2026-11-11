/**
 * Roofing classifier. The regex sources are reused verbatim in DuckDB SQL (regexp_matches, 'i'),
 * so they stay RE2-compatible (no lookarounds). A bare "roof" mention is roofing work unless it
 * names equipment, decks, solar, new-building geometry, porch/patio covers, masonry at the roof
 * line or work merely located on a roof; explicit reroof wording (STRONG) overrides those.
 * An explicit "no roof(ing) work" always wins. Chicago permits outside the Easy/Express reroof
 * tracks (renovation, new construction, porch, ...) count only as a roof job: STRONG wording and
 * no multi-scope marker.
 */
export const ROOFING_INCLUDE = String.raw`\bRE-?ROOF|\bROOF(ING)?\b|SHINGLE|TEAR[- ]?OFF`;
export const ROOFING_STRONG = String.raw`RE-?ROOF|ROOFING|SHINGLE|TEAR[- ]?OFF|ROOF ?(RE-?COVER|REPLACEMENT|REPAIRS?|COVERING|MEMBRANE)|(NEW|REPLACE|REPLACING) (EXISTING |FLAT |PITCHED |RUBBER )?ROOF([.,:/()-]|$| \(| -| AND| ON| FOR| WITH| SYSTEM| ONLY)`;
export const ROOFING_EXCLUDE = String.raw`ROOF ?DECK|ROOF ?TOP|GREEN ROOF|SOLAR|PHOTOVOLTAIC|\bPV\b|ROOF[- ]MOUNT|\bON (THE |EXISTING |MAIN |LEVEL \d+ )?ROOF\b|ROOF AREAS?|ROOF (VENTS?|DRAINS?|ANCHORS?|HEIGHT|HATCH|ACCESS|LEVELS?|LINE|WALLS?)|(GABLE|HIP|MANSARD) ROOF|ABOVE (THE )?ROOF|ANTENNA|TOWER|DAVIT|ROOF STRUCTURE OVER|ROOF OVER (THE |AN? )?(EXISTING |NEW |OUTDOOR |REAR |FRONT )*(PATIO|DECK|PORCH|BALCONY|STAIRS?|STEPS)|ROOF OVERHANG|OCCUPIABLE ROOF|OCCUPIED ROOF|ROOF TERRACES?|DORMER|ROOF (STAYS|TO REMAIN|REMAINS|TO STAY)|\bNO\b[^.()]*(,| OR| AND) ROOF\b|\bNO (NEW )?ROOF\b`;
export const ROOFING_NEGATED = String.raw`\bNO (RE-?)?ROOF(ING\b| WORK)`;
export const ROOFING_MULTI_SCOPE = String.raw`INTERIOR|REMODEL|RENOVAT|BUILD-? ?OUT|BUILT-? ?OUT|DECONVER|DORMER|\bADDITIONS?\b|REHAB|CHANGE (OF )?USE|\bERECT|NEW CONSTRUCTION|NEW BUILDING|\bGUT\b|PORCH`;
/** Chicago permit types whose roofing permits keep the general rule (Easy Permit Process, Express Permit Program). */
export const ROOFING_FAST_TRACK_TYPE = String.raw`EASY PERMIT|EXPRESS PERMIT`;
export const ROOFING_RULE = `work_description ~ /${ROOFING_INCLUDE}/i and not /${ROOFING_NEGATED}/i and (/${ROOFING_STRONG}/i or not /${ROOFING_EXCLUDE}/i)`;
export const ROOFING_RULE_STRICT = `chicago permit_type !~ /${ROOFING_FAST_TRACK_TYPE}/i: work_description ~ /${ROOFING_INCLUDE}/i and /${ROOFING_STRONG}/i and not /${ROOFING_NEGATED}/i and not /${ROOFING_MULTI_SCOPE}/i`;
export const ROOFING_EXCLUDED = {
  negated: `excluded:/${ROOFING_NEGATED}/i`,
  exclude: `excluded:/${ROOFING_EXCLUDE}/i`,
  notStrong: `excluded:chicago permit_type !~ /${ROOFING_FAST_TRACK_TYPE}/i needs /${ROOFING_STRONG}/i`,
  multiScope: `excluded:chicago permit_type !~ /${ROOFING_FAST_TRACK_TYPE}/i multi-scope /${ROOFING_MULTI_SCOPE}/i`,
} as const;

const include = new RegExp(ROOFING_INCLUDE, "i");
const strong = new RegExp(ROOFING_STRONG, "i");
const exclude = new RegExp(ROOFING_EXCLUDE, "i");
const negated = new RegExp(ROOFING_NEGATED, "i");
const multiScope = new RegExp(ROOFING_MULTI_SCOPE, "i");
const fastTrack = new RegExp(ROOFING_FAST_TRACK_TYPE, "i");

export interface RoofingMatch {
  is_roofing: boolean;
  roofing_match_rule: string | null;
}

export interface RoofingContext {
  sourceSystem?: string | null;
  permitType?: string | null;
}

export function classifyRoofing(
  workDescription: string | null | undefined,
  ctx: RoofingContext = {},
): RoofingMatch {
  if (!workDescription || !include.test(workDescription)) {
    return { is_roofing: false, roofing_match_rule: null };
  }
  const no = (rule: string): RoofingMatch => ({ is_roofing: false, roofing_match_rule: rule });
  if (negated.test(workDescription)) return no(ROOFING_EXCLUDED.negated);
  const isStrong = strong.test(workDescription);
  if (ctx.sourceSystem === "chicago_permits" && !fastTrack.test(ctx.permitType ?? "")) {
    if (!isStrong) return no(ROOFING_EXCLUDED.notStrong);
    if (multiScope.test(workDescription)) return no(ROOFING_EXCLUDED.multiScope);
    return { is_roofing: true, roofing_match_rule: ROOFING_RULE_STRICT };
  }
  if (!isStrong && exclude.test(workDescription)) return no(ROOFING_EXCLUDED.exclude);
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
