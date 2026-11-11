import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { expect, it } from "vitest";
import { openDataset } from "./duck.js";
import { publishedSnapshot } from "./snapshot.js";
import { datasetInfo, listRuns } from "../runs.js";

it("serves verified published rows and history while another process holds the ingestion write lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "published-serving-"));
  const dbPath = join(root, "cook_il.duckdb");
  const datasets = join(root, "dataset");
  const pubs = join(root, "publications");
  const runDir = join(datasets, "r1");
  mkdirSync(join(runDir, "property"), { recursive: true });
  mkdirSync(join(pubs, "r1"), { recursive: true });
  const writer = await DuckDBInstance.create(dbPath);
  const conn = await writer.connect();
  await conn.run(`CREATE TABLE property(pin14 varchar, source_system varchar, source_record_key varchar, source_url varchar);
    INSERT INTO property VALUES ('10253260360000', 'cook_parcels', '10253260360000|2026',
    'https://datacatalog.cookcountyil.gov/resource/pabr-t5kh?10253260360000|2026')`);
  const file = join(runDir, "property", "data_0.parquet");
  await conn.run(`COPY property TO '${file}' (FORMAT parquet)`);
  conn.closeSync();
  writer.closeSync();
  const bytes = readFileSync(file);
  writeFileSync(join(runDir, "property", "unpublished.parquet"), bytes);
  const manifest = {
    schema: "cook-il.artifact-manifest.v1",
    run_id: "r1",
    created_at: "2026-11-10T20:00:00Z",
    root_cid: "bafypublished",
    car: { name: "r1.car", size: 0, sha256: "", cid: null },
    previous_run_id: null,
    previous_root_cid: null,
    ipns: null,
    objects: [
      {
        name: "property/data_0.parquet",
        cid: "bafyfile",
        size: bytes.length,
        codec: "file",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
    pins: [],
    origins: [],
  };
  writeFileSync(join(pubs, "r1", "manifest.json"), JSON.stringify(manifest));
  writeFileSync(
    join(pubs, "r1", "verification.json"),
    JSON.stringify({
      run_id: "r1",
      root_cid: "bafypublished",
      verified_at: "2026-11-10T20:00:00Z",
      verifier: "test",
      gateways: [],
      checks: [],
      summary: { "test-gateway": { ok: 1, total: 1 } },
    }),
  );
  const history = ["r2", "r1"].map((run_id) => ({
    run_id,
    started_at: "2026-11-10T20:00:00Z",
    finished_at: "2026-11-10T20:01:00Z",
    status: "ok",
    mode: "incremental",
    sources: [],
    counts: {},
    deltas: {},
    dead_letters: [],
    limitations: [],
    root_cid: null,
    manifest_cid: null,
    previous_run_id: null,
  }));
  const historyPath = join(root, "run-history.json");
  writeFileSync(historyPath, JSON.stringify(history));
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {DuckDBInstance} from ${JSON.stringify(createRequire(import.meta.url).resolve("@duckdb/node-api"))}; const db = await DuckDBInstance.create(${JSON.stringify(dbPath)}); console.log('ready'); setInterval(()=>{},1000);`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await once(child.stdout, "data");
    await expect(DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" })).rejects.toThrow(
      /lock/i,
    );
    const ds = await openDataset(dbPath, datasets, { pubDirs: [pubs], historyPath });
    expect(await ds.query("SELECT pin14, source_url, source_url_original FROM property")).toEqual([
      {
        pin14: "10253260360000",
        source_url:
          "https://datacatalog.cookcountyil.gov/resource/pabr-t5kh.json?pin=10253260360000&year=2026",
        source_url_original:
          "https://datacatalog.cookcountyil.gov/resource/pabr-t5kh?10253260360000|2026",
      },
    ]);
    expect(readFileSync(file)).toEqual(bytes);
    expect(JSON.parse(readFileSync(join(pubs, "r1", "manifest.json"), "utf8"))).toEqual(manifest);
    expect((await publishedSnapshot(datasets, [pubs], historyPath))?.runId).toBe("r1");
    expect((await listRuns(ds, [pubs])).map((r) => r.run_id)).toEqual(["r2", "r1"]);
    expect((await datasetInfo(ds, [pubs])).source).toMatchObject({
      runId: "r1",
      publishedRunId: "r1",
      rootCid: "bafypublished",
    });
    await expect(ds.query("SELECT * FROM read_text('/etc/passwd')")).rejects.toThrow(
      /external access|disabled/i,
    );
    writeFileSync(file, "tampered");
    await expect(publishedSnapshot(datasets, [pubs], historyPath)).rejects.toThrow(
      /integrity mismatch/,
    );
  } finally {
    child.kill();
    await once(child, "exit");
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

it("required serving fails closed instead of falling through to the ingestion database", async () => {
  const root = mkdtempSync(join(tmpdir(), "missing-snapshot-"));
  try {
    await expect(
      openDataset(join(root, "writer.duckdb"), join(root, "dataset"), {
        pubDirs: [join(root, "publications")],
        historyPath: join(root, "run-history.json"),
      }),
    ).rejects.toThrow("no verified published snapshot");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
