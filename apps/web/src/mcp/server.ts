import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AppContext } from "../context.js";
import { guardSql } from "../db/sqlguard.js";
import { findProperties, getProperty, tableSchema } from "../search/properties.js";
import {
  FindPropertiesInput,
  FindPropertiesOutput,
  GetDatasetInfoOutput,
  GetPropertyInput,
  GetPropertyOutput,
  GetSchemaOutput,
  QueryDatasetInput,
  QueryDatasetOutput,
} from "./contracts.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
};
const ok = (out: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(out) }],
  structuredContent: out,
});

export const MCP_TOOLS = [
  "getDatasetInfo",
  "getSchema",
  "queryDataset",
  "findProperties",
  "getProperty",
] as const;

export function createMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: "cook-il-property-intelligence", version: "0.1.0" });

  server.registerTool(
    "getDatasetInfo",
    {
      description:
        "Current dataset snapshot: run id, root/manifest CIDs, record counts, limitations.",
      inputSchema: {},
      outputSchema: GetDatasetInfoOutput.shape,
    },
    async () => {
      const { run, source } = await ctx.info();
      return ok(
        GetDatasetInfoOutput.parse({
          ...source,
          counts: run.counts,
          limitations: run.limitations,
          source,
        }),
      );
    },
  );
  server.registerTool(
    "getSchema",
    {
      description:
        "Tables and columns of the query dataset (property, permit, contractor, business, sale, property_improvement_has_contractor, contractor_has_license, run, source_watermark).",
      inputSchema: {},
      outputSchema: GetSchemaOutput.shape,
    },
    async () =>
      ok(
        GetSchemaOutput.parse({
          tables: await tableSchema(ctx.ds),
          source: (await ctx.info()).source,
        }),
      ),
  );
  server.registerTool(
    "queryDataset",
    {
      description:
        "Run ONE read-only SELECT/WITH statement (DuckDB SQL). LIMIT is capped at 1000, 10 s timeout.",
      inputSchema: QueryDatasetInput.shape,
      outputSchema: QueryDatasetOutput.shape,
    },
    async (input) => {
      const { sql, limit } = QueryDatasetInput.parse(input);
      const rows = await ctx.ds.query(guardSql(sql, limit), [], 10_000);
      return ok(
        QueryDatasetOutput.parse({
          columns: Object.keys(rows[0] ?? {}),
          rows,
          rowCount: rows.length,
          truncated: rows.length >= limit,
          source: (await ctx.info()).source,
        }),
      );
    },
  );
  server.registerTool(
    "findProperties",
    {
      description:
        "Properties within radiusMiles of lat/lon (geohash prefilter + haversine) with their permits and contractor/BBB data. Filters: minRoofAge, openRoofingPermitsOnly, minOpenDays.",
      inputSchema: FindPropertiesInput.shape,
      outputSchema: FindPropertiesOutput.shape,
    },
    async (input) =>
      ok(
        FindPropertiesOutput.parse({
          ...(await findProperties(ctx.ds, FindPropertiesInput.parse(input))),
          source: (await ctx.info()).source,
        }),
      ),
  );
  server.registerTool(
    "getProperty",
    {
      description: "One property by 14-digit PIN with its permits and contractor/BBB data.",
      inputSchema: GetPropertyInput.shape,
      outputSchema: GetPropertyOutput.shape,
    },
    async (input) =>
      ok(
        GetPropertyOutput.parse({
          property: await getProperty(ctx.ds, GetPropertyInput.parse(input).pin14),
          source: (await ctx.info()).source,
        }),
      ),
  );
  return server;
}

/** Stateless streamable-HTTP handler: one server+transport per request. */
export async function handleMcpRequest(ctx: AppContext, req: Request): Promise<Response> {
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void transport.close();
  }
}
