// Local copy of the shared query-table contract (packages/shared/src/schemas.ts on the pipeline branch).
// Switch to `@cook/shared` at merge; shapes identical.
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
export const BbbState = z.enum(["confirmed_present", "confirmed_empty", "unavailable", "unknown"]);

export const PropertySchema = z.object({
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
export type Property = z.infer<typeof PropertySchema>;

export const PermitSchema = z.object({
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
export type Permit = z.infer<typeof PermitSchema>;

export const ContractorSchema = z.object({
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
  ...provenance,
});
export type Contractor = z.infer<typeof ContractorSchema>;

export const SourceCountSchema = z.object({
  source_system: z.string(),
  dataset_id: z.string(),
  url: z.string(),
  rows_fetched: z.number().int(),
  rows_staged: z.number().int(),
  watermark_value: z.string().nullable(),
  fetched_at: timestamp.nullable(),
});
export const DeltaSchema = z.object({
  inserted: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
});
export const DeadLetterSchema = z.object({
  source_system: z.string(),
  stage: z.enum(["fetch", "stage", "transform"]),
  key: z.string().nullable(),
  error: z.string(),
  at: timestamp,
});
export const RunSchema = z.object({
  run_id: z.string(),
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  status: z.enum(["running", "ok", "failed"]),
  mode: z.enum(["full", "incremental"]),
  sources: z.array(SourceCountSchema),
  counts: z.record(z.string(), z.number().int()),
  deltas: z.record(z.string(), DeltaSchema),
  dead_letters: z.array(DeadLetterSchema),
  limitations: z.array(z.string()),
  manifest_cid: z.string().nullable(),
  root_cid: z.string().nullable(),
  previous_run_id: z.string().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

export const ManifestArtifactSchema = z.object({
  cid: z.string(),
  name: z.string(),
  size: z.number(),
  codec: z.enum(["file", "directory"]),
  sha256: z.string().nullable().optional(),
  origins: z.array(z.string()).optional(),
});
export const ManifestSchema = z.object({
  run_id: z.string(),
  created_at: z.string().optional(),
  root_cid: z.string().nullable().optional(),
  manifest_cid: z.string().nullable().optional(),
  tables_cid: z.string().nullable().optional(),
  previous_root_cid: z.string().nullable().optional(),
  previous_run_id: z.string().nullable().optional(),
  ipns: z.object({ name: z.string(), resolved_cid: z.string() }).nullable().optional(),
  car: z
    .object({
      name: z.string(),
      cid: z.string().nullable().optional(),
      size: z.number().optional(),
    })
    .nullable()
    .optional(),
  artifacts: z.array(ManifestArtifactSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const VerificationSchema = z.object({
  verified_at: z.string().optional(),
  results: z.array(
    z.object({
      cid: z.string(),
      name: z.string().optional(),
      gateway: z.string(),
      url: z.string().optional(),
      status: z.union([z.number(), z.string()]),
      size_match: z.boolean().nullable(),
      digest_match: z.boolean().nullable(),
      fetched_at: z.string(),
      error: z.string().nullable().optional(),
    }),
  ),
});
export type Verification = z.infer<typeof VerificationSchema>;
