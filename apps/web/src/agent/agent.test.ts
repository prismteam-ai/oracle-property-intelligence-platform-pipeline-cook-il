import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFixture } from "../../../../fixtures/make-fixture.js";
import { openDataset, type Dataset } from "../db/duck.js";
import { createContext, type AppContext } from "../context.js";
import { loadEnv } from "../env.js";
import { LONG_OPEN_DAYS, SYSTEM_PROMPT, askAgent, assistantTurn, centerOf } from "./agent.js";
import { geocodePlace } from "./geocode.js";
import { agentTools, compact } from "./tools.js";

let ds: Dataset;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cook-il-agent-"));
  await makeFixture(join(dir, "cook_il.duckdb"), join(dir, "publications"));
  ds = await openDataset(join(dir, "cook_il.duckdb"), join(dir, "dataset"));
});
afterAll(async () => ds.close());

const ctxWith = (model: AppContext["model"] | MockLanguageModelV1): AppContext =>
  createContext({
    ds,
    env: loadEnv({ NOMINATIM_URL: "http://127.0.0.1:9/nope" }),
    pubDirs: [join(dir, "publications")],
    model: model as AppContext["model"],
  });

describe("askAgent (mocked model)", () => {
  it("runs the tool loop: tool call step then final text", async () => {
    let call = 0;
    const model = new MockLanguageModelV1({
      // eslint-disable-next-line @typescript-eslint/require-await
      doGenerate: async () => {
        call++;
        if (call === 1)
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: "tool-calls",
            usage: { promptTokens: 10, completionTokens: 5 },
            toolCalls: [
              {
                toolCallType: "function",
                toolCallId: "c1",
                toolName: "open_roofing_permits",
                args: JSON.stringify({
                  lat: 41.8781,
                  lon: -87.6298,
                  radiusMiles: 5,
                  minOpenDays: 1095,
                  limit: 5,
                }),
              },
            ],
          };
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 5 },
          text: "Found permits; see pin14 list.",
        };
      },
    });
    const res = await askAgent(
      ctxWith(model),
      "Which properties near Chicago have long-open roofing permits?",
    );
    expect(res.answer).toContain("Found permits");
    expect(res.steps).toEqual([
      {
        tool: "open_roofing_permits",
        args: expect.objectContaining({ radiusMiles: 5 }) as unknown,
      },
    ]);
    expect(res.source.runId).toMatch(/^2026-11-10/);
  });
  it("sends prior turns to the model and derives the search centre from geocode + radius tools", async () => {
    let call = 0;
    const prompts: unknown[] = [];
    const model = new MockLanguageModelV1({
      // eslint-disable-next-line @typescript-eslint/require-await
      doGenerate: async (opts) => {
        prompts.push(opts.prompt);
        call++;
        const base = {
          rawCall: { rawPrompt: null, rawSettings: {} },
          usage: { promptTokens: 1, completionTokens: 1 },
        };
        if (call === 1)
          return {
            ...base,
            finishReason: "tool-calls" as const,
            toolCalls: [
              {
                toolCallType: "function" as const,
                toolCallId: "g1",
                toolName: "geocode_place",
                args: JSON.stringify({ place: "Skokie" }),
              },
            ],
          };
        if (call === 2)
          return {
            ...base,
            finishReason: "tool-calls" as const,
            toolCalls: [
              {
                toolCallType: "function" as const,
                toolCallId: "p1",
                toolName: "open_roofing_permits",
                args: JSON.stringify({
                  lat: 42.0324,
                  lon: -87.7416,
                  radiusMiles: 5,
                  minOpenDays: LONG_OPEN_DAYS,
                  limit: 3,
                }),
              },
            ],
          };
        return { ...base, finishReason: "stop" as const, text: "answer two" };
      },
    });
    const history = [
      { role: "user" as const, content: "roofs near Evanston?" },
      {
        role: "assistant" as const,
        content:
          'prior answer\n\n(context: search centre lat 42.0451, lon -87.6877 for "Evanston")',
      },
    ];
    const res = await askAgent(ctxWith(model), "near that area, open for many years?", history);
    // prior turns precede the new question in what the model sees
    const first = prompts[0] as { role: string; content: unknown }[];
    expect(first.filter((m) => m.role !== "system").map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(JSON.stringify(first)).toContain("search centre lat 42.0451");
    expect(res.center).toEqual({ lat: 42.0324, lon: -87.7416, place: "Skokie" });
    expect(res.turn).toBe(assistantTurn({ answer: "answer two", center: res.center }));
    expect(res.turn).toContain("(context: search centre lat 42.0324, lon -87.7416");
    expect(res.steps.map((s) => s.tool)).toEqual(["geocode_place", "open_roofing_permits"]);
  });
  it("system prompt fixes the defaults: many years = 1,095 days, BBB line per contractor, reuse the last centre", () => {
    expect(LONG_OPEN_DAYS).toBe(1095);
    expect(SYSTEM_PROMPT).toContain("minOpenDays=1095");
    expect(SYSTEM_PROMPT).toContain("BBB: not available");
    expect(SYSTEM_PROMPT).toContain("most recent search centre");
    expect(centerOf([{ tool: "find_properties", args: { lat: 1, lon: 2 } }])).toEqual({
      lat: 1,
      lon: 2,
      place: null,
    });
    expect(centerOf([{ tool: "run_sql_readonly", args: { sql: "select 1" } }])).toBeNull();
  });
  it("reports a disabled agent without a model", async () => {
    const res = await askAgent(ctxWith(null), "anything");
    expect(res.answer).toMatch(/OPENAI_API_KEY/);
  });
});

describe("agent tools", () => {
  it("open_roofing_permits returns compact rows with permit ids, contractor and source urls", async () => {
    const tools = agentTools(ctxWith(null));
    const out = await tools.open_roofing_permits.execute(
      { lat: 41.8781, lon: -87.6298, radiusMiles: 5, minOpenDays: 365 * 3, limit: 5 },
      { toolCallId: "t", messages: [] },
    );
    expect(out.properties.length).toBe(5);
    const first = out.properties[0]!;
    expect(first.permits[0]?.permit_id).toBeTruthy();
    expect(first.permits[0]?.source_url).toMatch(/^https:/);
    expect(first.source_url).toMatch(/^https:/);
    expect(out.source.runId).toBeTruthy();
  });
  it("run_sql_readonly rejects writes and returns rows for selects", async () => {
    const tools = agentTools(ctxWith(null));
    const bad = await tools.run_sql_readonly.execute(
      { sql: "DROP TABLE property" },
      { toolCallId: "t", messages: [] },
    );
    expect(bad).toHaveProperty("error");
    const ok = await tools.run_sql_readonly.execute(
      { sql: "SELECT count(*)::INTEGER AS n FROM property" },
      { toolCallId: "t", messages: [] },
    );
    expect(ok).toMatchObject({ rowCount: 1, rows: [{ n: 5000 }] });
  });
  it("geocode falls back to built-in places when Nominatim is unreachable, and caches", async () => {
    const first = await geocodePlace("Evanston, IL", "http://127.0.0.1:9/nope");
    expect(first?.lat).toBeCloseTo(42.045, 2);
    expect(first?.cached).toBe(false);
    const second = await geocodePlace("Evanston, IL", "http://127.0.0.1:9/nope");
    expect(second?.cached).toBe(true);
    expect(await geocodePlace("Nowhereville", "http://127.0.0.1:9/nope")).toBeNull();
  });
  it("compact keeps only roofing permits", () => {
    const c = compact({
      pin14: "12345678901234",
      pin10: "1234567890",
      address: null,
      city: null,
      zip: null,
      lat: 1,
      lon: 2,
      geohash6: null,
      year_built: null,
      class: null,
      municipality: null,
      township: null,
      owner_name: null,
      mail_address: null,
      mail_city: null,
      mail_state: null,
      mail_zip: null,
      is_out_of_area: null,
      last_sale_date: null,
      last_sale_price: null,
      years_since_sale: null,
      roof_age_years: null,
      roof_age_basis: null,
      roof_age_confidence: null,
      roof_age_anchor_date: null,
      source_system: "s",
      source_record_key: "k",
      source_record_hash: "a".repeat(64),
      source_url: "u",
      ingested_at: "t",
      run_id: "r",
      distance_miles: 1.234,
      permits: [],
    });
    expect(c).toMatchObject({ pin14: "12345678901234", distance_miles: 1.23, permits: [] });
  });
});
