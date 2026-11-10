// Query-table contract: re-exported from @cook/shared (single source of truth). Only the
// IPFS publication file shapes (manifest / verification) are web-local.
import { z } from "zod";

export {
  BbbState,
  Contractor as ContractorSchema,
  DeadLetter as DeadLetterSchema,
  Delta as DeltaSchema,
  Permit as PermitSchema,
  Property as PropertySchema,
  RoofAgeBasis,
  RoofAgeConfidence,
  Run as RunSchema,
  SourceCount as SourceCountSchema,
} from "@cook/shared";
export type {
  Contractor,
  DeadLetter,
  Delta,
  Permit,
  Property,
  Run,
  SourceCount,
} from "@cook/shared";

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
