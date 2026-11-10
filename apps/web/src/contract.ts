// Local copy of the shared query-table contract (conventions.md). Switch to `@cook-il/shared` at merge; shapes identical.
import { z } from 'zod';

const provenance = {
  source_system: z.string(),
  source_record_key: z.string(),
  source_record_hash: z.string(),
  source_url: z.string(),
  ingested_at: z.string(),
  run_id: z.string(),
};

export const PropertySchema = z.object({
  pin14: z.string(),
  pin10: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  geohash6: z.string().nullable(),
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
  last_sale_date: z.string().nullable(),
  last_sale_price: z.number().nullable(),
  years_since_sale: z.number().nullable(),
  roof_age_years: z.number().nullable(),
  roof_age_basis: z.enum(['reroof_permit', 'year_built']).nullable(),
  roof_age_confidence: z.enum(['high', 'medium', 'low']).nullable(),
  roof_age_anchor_date: z.string().nullable(),
  ...provenance,
});
export type Property = z.infer<typeof PropertySchema>;

export const PermitSchema = z.object({
  permit_id: z.string(),
  source_system: z.string(),
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
  issued_at: z.string().nullable(),
  applied_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  open_days: z.number().int().nullable(),
  applicant_name: z.string().nullable(),
  contractor_name: z.string().nullable(),
  contractor_id: z.string().nullable(),
  municipality: z.string().nullable(),
  source_record_key: z.string(),
  source_record_hash: z.string(),
  source_url: z.string(),
  ingested_at: z.string(),
  run_id: z.string(),
});
export type Permit = z.infer<typeof PermitSchema>;

export const ContractorSchema = z.object({
  contractor_id: z.string(),
  name: z.string(),
  name_normalized: z.string(),
  license_number: z.string().nullable(),
  license_type: z.string().nullable(),
  license_status: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  county: z.string().nullable(),
  ever_disciplined: z.boolean().nullable(),
  bbb_rating: z.string().nullable(),
  bbb_url: z.string().nullable(),
  bbb_checked_at: z.string().nullable(),
  bbb_state: z.enum(['confirmed_present', 'confirmed_empty', 'unavailable', 'unknown']),
  ...provenance,
});
export type Contractor = z.infer<typeof ContractorSchema>;

export const RunSchema = z.object({
  run_id: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  status: z.string(),
  sources: z.array(
    z.object({
      source_system: z.string(),
      url: z.string(),
      records: z.number().optional(),
      fetched_at: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
  counts: z.record(z.number()),
  deltas: z.record(z.object({ added: z.number(), changed: z.number(), removed: z.number() }).partial()),
  dead_letters: z.array(z.record(z.unknown())),
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
  codec: z.enum(['file', 'directory']),
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
    .object({ name: z.string(), cid: z.string().nullable().optional(), size: z.number().optional() })
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
