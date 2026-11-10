import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { guardSql } from "../db/sqlguard.js";
import { FindPropertiesInput, GetPropertyInput, QueryDatasetInput } from "../mcp/contracts.js";
import { findProperties, getProperty, tableSchema } from "../search/properties.js";
import { coverage, getRun, listRuns, tableCounts } from "../runs.js";
import { gatewayUrls, getPublication } from "../publications.js";
import { askAgent } from "../agent/agent.js";

const t = initTRPC.context<AppContext>().create();
const p = t.procedure;

export const appRouter = t.router({
  runs: t.router({
    latest: p.query(async ({ ctx }) => {
      const [info, counts, cov, runs] = await Promise.all([
        ctx.info(),
        tableCounts(ctx.ds),
        coverage(ctx.ds),
        listRuns(ctx.ds),
      ]);
      const previous = runs.find((r) => r.run_id === info.run.previous_run_id) ?? runs[1] ?? null;
      return {
        run: info.run,
        source: info.source,
        previous,
        table_counts: counts,
        coverage: cov,
        dataset_origin: ctx.ds.origin,
        run_count: runs.length,
      };
    }),
    list: p.query(({ ctx }) => listRuns(ctx.ds)),
    get: p.input(z.object({ run_id: z.string() })).query(async ({ ctx, input }) => {
      const run = await getRun(ctx.ds, input.run_id);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return run;
    }),
  }),
  publications: t.router({
    get: p.input(z.object({ run_id: z.string() })).query(async ({ ctx, input }) => {
      const [run, pub] = await Promise.all([
        getRun(ctx.ds, input.run_id),
        getPublication(ctx.pubDirs, input.run_id),
      ]);
      const rootCid = pub.manifest?.root_cid ?? run?.root_cid ?? null;
      return {
        run,
        publication: pub,
        root_cid: rootCid,
        manifest_cid: pub.manifest?.manifest_cid ?? run?.manifest_cid ?? null,
        gateway_urls: rootCid ? gatewayUrls(rootCid) : [],
        artifacts: (pub.manifest?.artifacts ?? []).map((a) => ({
          ...a,
          gateways: gatewayUrls(a.cid),
        })),
      };
    }),
  }),
  query: t.router({
    sql: p.input(QueryDatasetInput).mutation(async ({ ctx, input }) => {
      let sql: string;
      try {
        sql = guardSql(input.sql, input.limit);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      const t0 = Date.now();
      const rows = await ctx.ds.query(sql, [], 10_000).catch((e: unknown) => {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
      });
      return {
        columns: Object.keys(rows[0] ?? {}),
        rows,
        rowCount: rows.length,
        truncated: rows.length >= input.limit,
        ms: Date.now() - t0,
        source: (await ctx.info()).source,
      };
    }),
    schema: p.query(({ ctx }) => tableSchema(ctx.ds)),
  }),
  search: t.router({
    properties: p.input(FindPropertiesInput).query(async ({ ctx, input }) => ({
      ...(await findProperties(ctx.ds, input)),
      source: (await ctx.info()).source,
    })),
  }),
  property: t.router({
    get: p.input(GetPropertyInput).query(async ({ ctx, input }) => ({
      property: await getProperty(ctx.ds, input.pin14),
      source: (await ctx.info()).source,
    })),
  }),
  agent: t.router({
    ask: p
      .input(z.object({ question: z.string().min(1).max(2000) }))
      .mutation(({ ctx, input }) => askAgent(ctx, input.question)),
  }),
});
export type AppRouter = typeof appRouter;
