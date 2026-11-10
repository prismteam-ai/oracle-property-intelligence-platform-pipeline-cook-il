import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const timestamp = z.string().min(1);
const provenance = {
  source_system: z.string(),
  source_record_key: z.string(),
  source_record_hash: z.string().length(64),
  source_url: z.string(),
  ingested_at: timestamp,
  run_id: z.string(),
};

export const RoofAgeBasis = z.enum(["reroof_permit", "new_construction_permit", "year_built"]);
export const RoofAgeConfidence = z.enum(["high", "medium", "low"]);
/** `stale` = rating read from an Internet Archive copy because the live profile was not reachable. */
export const BbbState = z.enum([
  "confirmed_present",
  "confirmed_empty",
  "unavailable",
  "unknown",
  "stale",
]);
export const BbbSource = z.enum(["live", "archive"]);
/** Permit -> contractor match tiers (kit confidence). Permits carry no license number or phone, so no higher tier exists. */
export const MatchTier = z.enum(["exact_normalized", "suffix_stripped", "dba"]);
export const MATCH_CONFIDENCE: Record<MatchTier, number> = {
  exact_normalized: 0.8,
  suffix_stripped: 0.7,
  dba: 0.7,
};

export const Property = z.object({
  pin14: z.string().length(14),
  pin10: z.string().length(10),
  address: z.string().nullable(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  geohash6: z.string().length(6).nullable(),
  year_built: z.number().int().nullable(),
  class: z.string().nullable(),
  municipality: z.string().nullable(),
  township: z.string().nullable(),
  owner_name: z.string().nullable(),
  mail_address: z.string().nullable(),
  mail_city: z.string().nullable(),
  mail_state: z.string().nullable(),
  mail_zip: z.string().nullable(),
  is_out_of_area: z.boolean().nullable(),
  last_sale_date: date.nullable(),
  last_sale_price: z.number().nullable(),
  years_since_sale: z.number().nullable(),
  roof_age_years: z.number().nullable(),
  roof_age_basis: RoofAgeBasis.nullable(),
  roof_age_confidence: RoofAgeConfidence.nullable(),
  roof_age_anchor_date: date.nullable(),
  ...provenance,
});

export const Permit = z.object({
  permit_id: z.string(),
  pin14: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  geohash6: z.string().nullable(),
  permit_type: z.string().nullable(),
  work_description: z.string().nullable(),
  is_roofing: z.boolean(),
  roofing_match_rule: z.string().nullable(),
  status: z.string().nullable(),
  status_is_open: z.boolean(),
  issued_at: date.nullable(),
  applied_at: date.nullable(),
  closed_at: date.nullable(),
  open_days: z.number().int().nullable(),
  applicant_name: z.string().nullable(),
  contractor_name: z.string().nullable(),
  contractor_id: z.string().nullable(),
  contractor_match_tier: z.string().nullable(),
  municipality: z.string().nullable(),
  ...provenance,
});

export const Contractor = z.object({
  contractor_id: z.string(),
  name: z.string(),
  name_normalized: z.string(),
  license_number: z.string(),
  license_type: z.string(),
  license_status: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  county: z.string().nullable(),
  ever_disciplined: z.boolean().nullable(),
  bbb_rating: z.string().nullable(),
  bbb_url: z.string().nullable(),
  bbb_checked_at: timestamp.nullable(),
  bbb_state: BbbState,
  bbb_reason: z.string().nullable().default(null),
  bbb_source: BbbSource.nullable().default(null),
  ...provenance,
});

/** Edge: permit (property improvement) -> contractor company, with the tier that produced it. */
export const PropertyImprovementHasContractor = z.object({
  permit_id: z.string(),
  contractor_id: z.string(),
  match_tier: MatchTier,
  match_confidence: z.number(),
  matched_name_key: z.string(),
  run_id: z.string(),
});

/** Edge: contractor company -> licensing-authority license (one row per contractor with a license number). */
export const ContractorHasLicense = z.object({
  contractor_id: z.string(),
  license_number: z.string(),
  license_type: z.string(),
  license_status: z.string().nullable(),
  authority: z.literal("IDFPR"),
  source_url: z.string(),
  run_id: z.string(),
});

export const Business = z.object({
  license_id: z.string(),
  legal_name: z.string().nullable(),
  dba: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  geohash6: z.string().nullable(),
  license_description: z.string().nullable(),
  status: z.string().nullable(),
  issued_at: date.nullable(),
  expires_at: date.nullable(),
  ...provenance,
});

export const Sale = z.object({
  sale_id: z.string(),
  pin14: z.string(),
  sale_date: date.nullable(),
  sale_price: z.number().nullable(),
  deed_type: z.string().nullable(),
  buyer_name: z.string().nullable(),
  seller_name: z.string().nullable(),
  doc_no: z.string().nullable(),
  ...provenance,
});

export const SourceCount = z.object({
  source_system: z.string(),
  dataset_id: z.string(),
  url: z.string(),
  rows_fetched: z.number().int(),
  rows_staged: z.number().int(),
  watermark_value: z.string().nullable(),
  fetched_at: timestamp.nullable(),
});

export const Delta = z.object({
  inserted: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
});

export const DeadLetter = z.object({
  source_system: z.string(),
  stage: z.enum(["fetch", "stage", "transform"]),
  key: z.string().nullable(),
  error: z.string(),
  at: timestamp,
});

export const Run = z.object({
  run_id: z.string(),
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  status: z.enum(["running", "ok", "failed"]),
  mode: z.enum(["full", "incremental"]),
  sources: z.array(SourceCount),
  counts: z.record(z.string(), z.number().int()),
  deltas: z.record(z.string(), Delta),
  dead_letters: z.array(DeadLetter),
  limitations: z.array(z.string()),
  manifest_cid: z.string().nullable(),
  root_cid: z.string().nullable(),
  previous_run_id: z.string().nullable(),
});

export const SourceWatermark = z.object({
  source_system: z.string(),
  watermark_field: z.string(),
  watermark_value: z.string().nullable(),
  last_run_id: z.string(),
});

export type Property = z.infer<typeof Property>;
export type Permit = z.infer<typeof Permit>;
export type Contractor = z.infer<typeof Contractor>;
export type Business = z.infer<typeof Business>;
export type Sale = z.infer<typeof Sale>;
export type PropertyImprovementHasContractor = z.infer<typeof PropertyImprovementHasContractor>;
export type ContractorHasLicense = z.infer<typeof ContractorHasLicense>;
export type MatchTier = z.infer<typeof MatchTier>;
export type BbbState = z.infer<typeof BbbState>;
export type BbbSource = z.infer<typeof BbbSource>;
export type Run = z.infer<typeof Run>;
export type SourceCount = z.infer<typeof SourceCount>;
export type Delta = z.infer<typeof Delta>;
export type DeadLetter = z.infer<typeof DeadLetter>;
export type SourceWatermark = z.infer<typeof SourceWatermark>;
export type RoofAgeBasis = z.infer<typeof RoofAgeBasis>;
export type RoofAgeConfidence = z.infer<typeof RoofAgeConfidence>;

export const CONTRACT_TABLES = [
  "property",
  "permit",
  "contractor",
  "business",
  "sale",
  "property_improvement_has_contractor",
  "contractor_has_license",
  "run",
  "source_watermark",
] as const;
export type ContractTable = (typeof CONTRACT_TABLES)[number];
