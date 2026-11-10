// MCP tool contracts. The roofing CRM consumes exactly these shapes; keep changes additive.
import { z } from "zod";
import { ContractorSchema, PermitSchema, PropertySchema } from "../contract.js";

export const SourceSchema = z.object({
  runId: z.string(),
  rootCid: z.string().nullable(),
  manifestCid: z.string().nullable(),
  tablesCid: z.string().nullable().optional(),
  /** run whose publication the CIDs come from (newest published run at or before runId) */
  publishedRunId: z.string().nullable().optional(),
  syncedAt: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

export const GetDatasetInfoOutput = z.object({
  runId: z.string(),
  rootCid: z.string().nullable(),
  manifestCid: z.string().nullable(),
  tablesCid: z.string().nullable().optional(),
  counts: z.record(z.string(), z.number()),
  limitations: z.array(z.string()),
  syncedAt: z.string(),
  source: SourceSchema,
});

export const GetSchemaOutput = z.object({
  tables: z.array(
    z.object({
      name: z.string(),
      columns: z.array(z.object({ name: z.string(), type: z.string() })),
    }),
  ),
  source: SourceSchema,
});

export const QueryDatasetInput = z.object({
  sql: z
    .string()
    .min(1)
    .max(20_000)
    .describe("One read-only SELECT or WITH statement over the query tables"),
  limit: z.number().int().min(1).max(1000).default(100),
});
export const QueryDatasetOutput = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number(),
  truncated: z.boolean(),
  source: SourceSchema,
});

/**
 * One predicate for UI (tRPC search.properties), agent tools and MCP findProperties. Strict: an unknown key such as a
 * misspelt filter is an error, never a silently ignored filter.
 */
export const FindPropertiesInput = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radiusMiles: z.number().positive().max(50),
    minRoofAge: z
      .number()
      .min(0)
      .optional()
      .describe(
        "Only roofs at least this many years old (rows with unknown roof age are excluded)",
      ),
    minRoofAgeYears: z.number().min(0).optional().describe("Alias of minRoofAge"),
    openRoofingPermitsOnly: z
      .boolean()
      .optional()
      .describe("Only properties with an open roofing permit"),
    minOpenDays: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("With openRoofingPermitsOnly: permit open at least this many days"),
    limit: z.number().int().min(1).max(500).default(50),
  })
  .strict();
export type FindPropertiesInput = z.infer<typeof FindPropertiesInput>;

export const PermitWithContractor = PermitSchema.extend({
  contractor: ContractorSchema.nullable(),
});
export const PropertyWithPermits = PropertySchema.extend({
  distance_miles: z.number().nullable(),
  permits: z.array(PermitWithContractor),
});
export type PropertyWithPermits = z.infer<typeof PropertyWithPermits>;

export const FindPropertiesOutput = z.object({
  properties: z.array(PropertyWithPermits),
  total_in_radius: z.number().int(),
  source: SourceSchema,
});

export const GetPropertyInput = z.object({ pin14: z.string().regex(/^\d{14}$/) });
export const GetPropertyOutput = z.object({
  property: PropertyWithPermits.nullable(),
  source: SourceSchema,
});
