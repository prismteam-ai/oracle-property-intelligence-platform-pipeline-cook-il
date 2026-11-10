import { jsonSchema, tool, type Schema } from "ai";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { guardSql } from "../db/sqlguard.js";
import { findProperties } from "../search/properties.js";
import type { PropertyWithPermits } from "../mcp/contracts.js";
import { geocodePlace } from "./geocode.js";

/** Trim a property to what the model needs to cite (pin14, permit ids, source URLs). */
export function compact(p: PropertyWithPermits) {
  return {
    pin14: p.pin14,
    address: p.address,
    city: p.city,
    lat: p.lat,
    lon: p.lon,
    distance_miles: p.distance_miles === null ? null : Math.round(p.distance_miles * 100) / 100,
    year_built: p.year_built,
    roof_age_years: p.roof_age_years,
    roof_age_basis: p.roof_age_basis,
    roof_age_confidence: p.roof_age_confidence,
    owner_name: p.owner_name,
    is_out_of_area: p.is_out_of_area,
    years_since_sale: p.years_since_sale,
    source_url: p.source_url,
    permits: p.permits
      .filter((x) => x.is_roofing)
      .map((x) => ({
        permit_id: x.permit_id,
        status: x.status,
        status_is_open: x.status_is_open,
        issued_at: x.issued_at,
        open_days: x.open_days,
        work_description: x.work_description,
        contractor_name: x.contractor_name,
        bbb_rating: x.contractor?.bbb_rating ?? null,
        bbb_state: x.contractor?.bbb_state ?? "unknown",
        bbb_url: x.contractor?.bbb_url ?? null,
        source_url: x.source_url,
      })),
  };
}

/** `ai` 4.3 only converts zod 3 schemas itself; the web is on zod 4, so hand it JSON Schema + validator. */
export function params<S extends z.ZodType>(schema: S): Schema<z.infer<S>> {
  return jsonSchema<z.infer<S>>(z.toJSONSchema(schema) as Parameters<typeof jsonSchema>[0], {
    validate: (value) => {
      const r = schema.safeParse(value);
      return r.success ? { success: true, value: r.data } : { success: false, error: r.error };
    },
  });
}

export function agentTools(ctx: AppContext) {
  const radius = {
    lat: z.number(),
    lon: z.number(),
    radiusMiles: z.number().positive().max(25).default(5),
    limit: z.number().int().min(1).max(50).default(15),
  };
  return {
    geocode_place: tool({
      description:
        "Resolve a Cook County, IL place name (city, neighbourhood, address) to lat/lon.",
      parameters: params(z.object({ place: z.string() })),
      execute: async ({ place }) =>
        (await geocodePlace(place, ctx.env.NOMINATIM_URL)) ?? {
          error: `could not geocode "${place}"`,
        },
    }),
    find_properties: tool({
      description:
        "Properties within radiusMiles of a point, optionally only roofs at least minRoofAge years old. Returns roof-age basis/confidence and source URLs.",
      parameters: params(z.object({ ...radius, minRoofAge: z.number().min(0).optional() })),
      execute: async (input) => {
        const r = await findProperties(ctx.ds, input);
        return {
          total_in_radius: r.total_in_radius,
          returned: r.properties.length,
          properties: r.properties.map(compact),
          source: (await ctx.info()).source,
        };
      },
    }),
    open_roofing_permits: tool({
      description:
        "Properties within radiusMiles that have an OPEN roofing permit, longest-open first, with contractor and BBB rating when available.",
      parameters: params(z.object({ ...radius, minOpenDays: z.number().int().min(0).default(0) })),
      execute: async (input) => {
        const r = await findProperties(ctx.ds, { ...input, openRoofingPermitsOnly: true });
        return {
          total_in_radius: r.total_in_radius,
          returned: r.properties.length,
          properties: r.properties.map(compact),
          source: (await ctx.info()).source,
        };
      },
    }),
    run_sql_readonly: tool({
      description:
        "Run one read-only SELECT over tables property, permit, contractor, business, sale, run (DuckDB SQL, max 200 rows).",
      parameters: params(z.object({ sql: z.string() })),
      execute: async ({ sql }) => {
        try {
          const rows = await ctx.ds.query(guardSql(sql, 200), [], 10_000);
          return { rowCount: rows.length, rows };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
  };
}
