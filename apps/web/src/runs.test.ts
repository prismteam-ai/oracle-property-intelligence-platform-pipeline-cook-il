import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dataset, Row } from "./db/duck.js";
import { manifestSha256 } from "./publications.js";
import { datasetInfo, listRuns, newestPublished, rowToRun, sourceStatus } from "./runs.js";

const runRow = (run_id: string, previous_run_id: string | null, root_cid: string | null): Row => ({
  run_id,
  started_at: `${run_id.slice(0, 4)}-01-01T00:00:00Z`,
  finished_at: null,
  status: "ok",
  mode: "full",
  sources: "[]",
  counts: "{}",
  deltas: "{}",
  dead_letters: "[]",
  limitations: "[]",
  manifest_cid: null,
  root_cid,
  previous_run_id,
});

/** Fake dataset: three runs, only r1 carries a root_cid on its row. */
const rows = [runRow("r3", "r2", null), runRow("r2", "r1", null), runRow("r1", null, "bafyrow1")];
const ds: Dataset = {
  origin: { kind: "duckdb", path: "fake" },
  query: (sql: string, params: unknown[] = []) =>
    Promise.resolve(
      sql.includes("WHERE run_id = ?")
        ? rows.filter((r) => r.run_id === params[0])
        : sql.includes("LIMIT 1")
          ? rows.slice(0, 1)
          : rows,
    ),
  close: () => Promise.resolve(),
};

const manifest = (run_id: string, previous_run_id: string | null) =>
  JSON.stringify({
    schema: "cook-il.artifact-manifest.v1",
    run_id,
    created_at: "2026-11-10T00:00:00Z",
    root_cid: `bafyroot-${run_id}`,
    car: { name: `${run_id}.car`, size: 1, sha256: "a".repeat(64), cid: null },
    previous_run_id,
    previous_root_cid: previous_run_id ? `bafyroot-${previous_run_id}` : null,
    ipns: null,
    objects: [],
    pins: [],
    origins: [],
  });

describe("published-run resolution", () => {
  it("walks previous_run_id to the newest run with a publication and computes manifest_cid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    mkdirSync(join(dir, "r2"));
    const raw = manifest("r2", "r1");
    writeFileSync(join(dir, "r2", "manifest.json"), raw);
    const info = await datasetInfo(ds, [dir]);
    expect(info.run.run_id).toBe("r3");
    expect(info.source).toMatchObject({
      runId: "r3",
      publishedRunId: "r2",
      rootCid: "bafyroot-r2",
      manifestCid: manifestSha256(raw),
    });
    const runs = await listRuns(ds, [dir]);
    expect(runs.map((r) => [r.run_id, r.root_cid])).toEqual([
      ["r3", null],
      ["r2", "bafyroot-r2"],
      ["r1", "bafyrow1"],
    ]);
  });
  it("prefers run.json manifest_cid and falls back to the row's own root_cid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    mkdirSync(join(dir, "r2"));
    writeFileSync(join(dir, "r2", "manifest.json"), manifest("r2", "r1"));
    writeFileSync(join(dir, "r2", "run.json"), JSON.stringify({ manifest_cid: "sidecar" }));
    expect((await newestPublished(ds, [dir], rowToRun(rows[0]!)))?.manifest_cid).toBe("sidecar");
    expect((await newestPublished(ds, [], rowToRun(rows[0]!)))?.run_id).toBe("r1");
  });
  it("falls back to lexically older publication dirs when the chain is broken", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    mkdirSync(join(dir, "r0"));
    writeFileSync(join(dir, "r0", "manifest.json"), manifest("r0", null));
    const orphan = rowToRun(runRow("r4", null, null));
    expect((await newestPublished(ds, [dir], orphan))?.run_id).toBe("r0");
  });
});

describe("sourceStatus", () => {
  it("reports the last run that fetched rows, not the zeros of a cached run", async () => {
    const src = (rows_fetched: number, fetched_at: string | null) =>
      JSON.stringify([
        {
          source_system: "a",
          dataset_id: "x",
          url: "u",
          rows_fetched,
          rows_staged: 0,
          watermark_value: null,
          fetched_at,
        },
      ]);
    const r = [
      { ...runRow("r3", "r2", null), sources: src(0, null) },
      { ...runRow("r2", "r1", null), sources: src(42, "2026-11-09T00:00:00Z") },
      { ...runRow("r1", null, null), sources: src(7, "2026-11-08T00:00:00Z") },
    ];
    const fake: Dataset = {
      ...ds,
      query: (sql: string) =>
        Promise.resolve(
          sql.includes("source_watermark")
            ? [
                {
                  source_system: "a",
                  watermark_field: ":updated_at",
                  watermark_value: "w",
                  last_run_id: "r2",
                },
              ]
            : r,
        ),
    };
    const out = await sourceStatus(fake, await listRuns(fake));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source_system: "a",
      rows_fetched: 0,
      last_fetch: { run_id: "r2", rows_fetched: 42, fetched_at: "2026-11-09T00:00:00Z" },
      watermark: { field: ":updated_at", value: "w", last_run_id: "r2" },
    });
  });
  it("falls back to source_watermark when no run in history fetched rows", async () => {
    const zero = JSON.stringify([
      {
        source_system: "a",
        dataset_id: "x",
        url: "u",
        rows_fetched: 0,
        rows_staged: 0,
        watermark_value: null,
        fetched_at: null,
      },
    ]);
    const r = [{ ...runRow("r3", null, null), sources: zero }];
    const fake: Dataset = {
      ...ds,
      query: (sql: string) =>
        Promise.resolve(
          sql.includes("source_watermark")
            ? [
                {
                  source_system: "a",
                  watermark_field: ":updated_at",
                  watermark_value: "2026-11-09T00:00:00",
                  last_run_id: "r0",
                },
              ]
            : r,
        ),
    };
    const out = await sourceStatus(fake, await listRuns(fake));
    expect(out[0]?.last_fetch).toEqual({
      run_id: "r0",
      rows_fetched: null,
      fetched_at: "2026-11-09T00:00:00",
    });
    const none = await sourceStatus(
      {
        ...fake,
        query: (sql: string) => Promise.resolve(sql.includes("source_watermark") ? [] : r),
      },
      await listRuns(fake),
    );
    expect(none[0]?.last_fetch).toBeNull();
  });
});
