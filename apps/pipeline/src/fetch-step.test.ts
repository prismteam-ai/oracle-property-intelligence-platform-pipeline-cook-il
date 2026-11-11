import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Duck } from "@cook/duck";
import pino from "pino";
import { fetchStep } from "./run.js";
import { findSource } from "./sources.js";

afterEach(() => vi.unstubAllGlobals());

it("isolates sources: one failing source is a dead letter, the others still complete", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "fetch-step-"));
  const db = await Duck.open(join(dataDir, "t.duckdb"));
  vi.stubGlobal("fetch", (url: string) =>
    Promise.resolve(
      url.includes("pzzh-kp68")
        ? new Response("forbidden", { status: 403 })
        : Response.json([{ n: "0", max_updated_at: null }]),
    ),
  );
  try {
    const results = await fetchStep({
      db,
      dataDir,
      auth: { keyId: "k", keySecret: "s" },
      log: pino({ level: "silent" }),
      runId: "20261111T000000Z",
      incremental: true,
      sources: [findSource("chicago_permits"), findSource("idfpr_roofing")],
    });
    const bySource = Object.fromEntries(results.map((r) => [r.source_system, r]));
    expect(bySource["chicago_permits"]?.done?.rows_fetched).toBe(0);
    expect(bySource["chicago_permits"]?.dead_letters).toEqual([]);
    expect(bySource["idfpr_roofing"]?.done).toBeNull();
    expect(bySource["idfpr_roofing"]?.dead_letters[0]?.error).toMatch(/HTTP 403/);
  } finally {
    db.close();
  }
});
