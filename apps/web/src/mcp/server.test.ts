import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFixture } from "../../../../fixtures/make-fixture.js";
import { openDataset, type Dataset } from "../db/duck.js";
import { createContext } from "../context.js";
import { loadEnv } from "../env.js";
import { createApp, rateLimiter } from "../server.js";
import { MCP_TOOLS } from "./server.js";
import {
  FindPropertiesOutput,
  GetDatasetInfoOutput,
  GetPropertyOutput,
  GetSchemaOutput,
  QueryDatasetOutput,
  SourceSchema,
} from "./contracts.js";

let ds: Dataset;
let app: ReturnType<typeof createApp>;
const TOKEN = "test-token";
const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: `Bearer ${TOKEN}`,
};

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "cook-il-mcp-"));
  await makeFixture(join(dir, "cook_il.duckdb"), join(dir, "publications"));
  ds = await openDataset(join(dir, "cook_il.duckdb"), join(dir, "dataset"));
  const ctx = createContext({
    ds,
    env: loadEnv({ MCP_HTTP_AUTH_TOKEN: TOKEN }),
    pubDirs: [join(dir, "publications")],
    model: null,
  });
  app = createApp(ctx, { uiDir: join(dir, "no-ui"), build: { commit: "test", builtAt: "now" } });
});
afterAll(async () => ds.close());

async function rpc(method: string, params: unknown = {}, id = 1): Promise<Record<string, unknown>> {
  const res = await app.request("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}
async function call(name: string, args: unknown): Promise<Record<string, unknown>> {
  const r = (await rpc("tools/call", { name, arguments: args })) as {
    result?: {
      structuredContent: Record<string, unknown>;
      isError?: boolean;
      content: { text: string }[];
    };
    error?: { message: string };
  };
  if (r.error) throw new Error(r.error.message);
  if (!r.result || r.result.isError) throw new Error(r.result?.content[0]?.text ?? "no result");
  return r.result.structuredContent;
}

describe("MCP server over HTTP", () => {
  it("requires the bearer token", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer wrong" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
  it("initializes and lists exactly the contract tools", async () => {
    const init = (await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    })) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("cook-il-property-intelligence");
    const list = (await rpc("tools/list")) as {
      result: { tools: { name: string; outputSchema?: unknown }[] };
    };
    expect(list.result.tools.map((t) => t.name).sort()).toEqual([...MCP_TOOLS].sort());
    for (const t of list.result.tools) expect(t.outputSchema).toBeDefined();
  });
  it("every tool returns a source block matching SourceSchema", async () => {
    const pin = String((await ds.query("SELECT pin14 FROM property LIMIT 1"))[0]?.pin14);
    const outs = await Promise.all([
      call("getDatasetInfo", {}),
      call("getSchema", {}),
      call("queryDataset", { sql: "SELECT count(*)::INTEGER AS n FROM property", limit: 5 }),
      call("findProperties", { lat: 42.0451, lon: -87.6877, radiusMiles: 1, limit: 3 }),
      call("getProperty", { pin14: pin }),
    ]);
    for (const o of outs) expect(SourceSchema.parse(o.source).runId).toMatch(/^2026-11-10/);
    expect(GetDatasetInfoOutput.parse(outs[0]).counts.property).toBe(5000);
    expect(GetSchemaOutput.parse(outs[1]).tables.map((t) => t.name)).toContain("permit");
    expect(QueryDatasetOutput.parse(outs[2]).rows).toEqual([{ n: 5000 }]);
    const fp = FindPropertiesOutput.parse(outs[3]);
    expect(fp.properties).toHaveLength(3);
    expect(fp.properties[0]?.distance_miles).toBeLessThanOrEqual(1);
    expect(GetPropertyOutput.parse(outs[4]).property?.pin14).toBe(pin);
  });
  it("queryDataset rejects writes and multi-statements as tool errors", async () => {
    await expect(call("queryDataset", { sql: "DELETE FROM property" })).rejects.toThrow(/SELECT/);
    await expect(call("queryDataset", { sql: "SELECT 1; SELECT 2" })).rejects.toThrow(
      /one statement/,
    );
  });
  it("findProperties validates input", async () => {
    await expect(call("findProperties", { lat: 100, lon: 0, radiusMiles: 1 })).rejects.toThrow();
  });
  it("findProperties applies the roof-age filter under both names and rejects unknown filters", async () => {
    const q = { lat: 42.0451, lon: -87.6877, radiusMiles: 2, limit: 500 };
    const all = FindPropertiesOutput.parse(await call("findProperties", q));
    const a = FindPropertiesOutput.parse(await call("findProperties", { ...q, minRoofAge: 40 }));
    const b = FindPropertiesOutput.parse(
      await call("findProperties", { ...q, minRoofAgeYears: 40 }),
    );
    expect(a.total_in_radius).toBeGreaterThan(0);
    expect(a.total_in_radius).toBeLessThan(all.total_in_radius);
    expect(a.total_in_radius).toBe(a.properties.length);
    for (const p of a.properties) expect(p.roof_age_years).toBeGreaterThanOrEqual(40);
    expect(b.properties.map((p) => p.pin14)).toEqual(a.properties.map((p) => p.pin14));
    await expect(call("findProperties", { ...q, minRoofAgeYrs: 40 })).rejects.toThrow(
      /minRoofAgeYrs/,
    );
  });
});

describe("http basics", () => {
  it("health and build.json", async () => {
    expect(await (await app.request("/health")).json()).toMatchObject({
      ok: true,
      runId: expect.stringMatching(/^2026/) as unknown,
    });
    expect(await (await app.request("/build.json")).json()).toEqual({
      commit: "test",
      builtAt: "now",
    });
  });
  it("tRPC query.sql returns 400 for forbidden SQL", async () => {
    const res = await app.request("/trpc/query.sql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: "DROP TABLE property" }),
    });
    expect(res.status).toBe(400);
  });
  it("rate limiter allows max hits per window", () => {
    const allow = rateLimiter(3, 1000);
    expect([allow("a", 0), allow("a", 1), allow("a", 2), allow("a", 3)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(allow("b", 3)).toBe(true);
    expect(allow("a", 1001)).toBe(true);
  });
});
