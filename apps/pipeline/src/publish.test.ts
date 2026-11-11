import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duck } from "@cook/duck";
import { ensureRunSchema } from "./run.js";
import {
  latestPublishedRun,
  pickRunToPublish,
  pinPublishedManifests,
  publish,
  sha256Hex,
  verifyPublished,
} from "./publish.js";

const DEAD = ["http://127.0.0.1:9/ipfs/"];

describe("publish / verify commands", () => {
  it("writes manifest+verification under publications/, the CAR under data/, and records CIDs on the run", async () => {
    const root = mkdtempSync(join(tmpdir(), "pub-cmd-"));
    const dataDir = join(root, "data");
    const pubDir = join(root, "publications");
    mkdirSync(join(dataDir, "dataset", "r2", "property"), { recursive: true });
    writeFileSync(
      join(dataDir, "dataset", "r2", "property", "part-0000.parquet"),
      "not really parquet",
    );
    const db = await Duck.open(join(dataDir, "cook_il.duckdb"));
    await ensureRunSchema(db);
    await db.exec(
      "insert into run (run_id, started_at, status, mode, root_cid, previous_run_id) values ('r1', now(), 'ok', 'full', 'bafyprev', null), ('r2', now(), 'ok', 'incremental', null, 'r1'), ('r3', now(), 'ok', 'incremental', null, null)",
    );
    db.close();

    const r = await publish({
      runId: "r2",
      dataDir,
      publicationsDir: pubDir,
      verifier: "test",
      env: {},
      gateways: DEAD,
      timeoutMs: 500,
      retries: 0,
      minPins: 0,
      minVerifiedGateways: 0,
    });
    expect(r.manifest.previous_root_cid).toBe("bafyprev");
    expect(r.manifest.pins.map((p) => [p.provider, p.ok])).toEqual([
      ["filebase", false],
      ["pinata", false],
    ]);
    expect(r.manifest.pins.every((p) => p.detail?.startsWith("skipped"))).toBe(true);
    expect(existsSync(join(pubDir, "r2", "manifest.json"))).toBe(true);
    expect(existsSync(join(pubDir, "r2", "verification.json"))).toBe(true);
    expect(existsSync(join(dataDir, "publications", "r2", "r2.car"))).toBe(true);
    expect(existsSync(join(pubDir, "r2", "r2.car"))).toBe(false);
    expect(r.manifestCid).toBe(sha256Hex(readFileSync(join(pubDir, "r2", "manifest.json"))));
    // no pinning credentials: the manifest is not pinned, so its sha256 stands in for the CID
    expect(JSON.parse(readFileSync(join(pubDir, "r2", "run.json"), "utf8"))).toEqual({
      run_id: "r2",
      root_cid: r.manifest.root_cid,
      manifest_cid: r.manifestCid,
      manifest_sha256: r.manifestCid,
      manifest_pins: [],
      previous_run_id: "r1",
      previous_root_cid: "bafyprev",
    });

    const db2 = await Duck.open(join(dataDir, "cook_il.duckdb"));
    const row = await db2.one<{ root_cid: string; manifest_cid: string }>(
      "select root_cid, manifest_cid from run where run_id = 'r2'",
    );
    db2.close();
    expect(row).toEqual({ root_cid: r.manifest.root_cid, manifest_cid: r.manifestCid });

    expect(latestPublishedRun(pubDir)).toBe("r2");
    const v = await verifyPublished({
      runId: "r2",
      publicationsDir: pubDir,
      verifier: "github actions",
      gateways: DEAD,
      timeoutMs: 500,
      retries: 0,
    });
    expect(v.file).toBe(join(pubDir, "r2", "verification-github-actions.json"));
    expect(v.verification.summary[DEAD[0]!]).toEqual({ ok: 0, total: 1 });

    // r3: --previous r2 whose row has no root_cid in this DB copy -> chain from r2's manifest file
    const db3 = await Duck.open(join(dataDir, "cook_il.duckdb"));
    await db3.exec("update run set root_cid = null where run_id = 'r2'");
    db3.close();
    mkdirSync(join(dataDir, "dataset", "r3", "property"), { recursive: true });
    writeFileSync(join(dataDir, "dataset", "r3", "property", "part-0000.parquet"), "r3 bytes");
    const r3 = await publish({
      runId: "r3",
      previous: "r2",
      carUrl: "https://example.com/releases/r3.car",
      dataDir,
      publicationsDir: pubDir,
      verifier: "test",
      env: {},
      gateways: DEAD,
      timeoutMs: 500,
      retries: 0,
      minPins: 0,
      minVerifiedGateways: 0,
    });
    expect(r3.manifest.previous_run_id).toBe("r2");
    expect(r3.manifest.previous_root_cid).toBe(r.manifest.root_cid);
    expect(r3.manifest.car.release_url).toBe("https://example.com/releases/r3.car");
    const db4 = await Duck.open(join(dataDir, "cook_il.duckdb"));
    const row3 = await db4.one<{ previous_run_id: string }>(
      "select previous_run_id from run where run_id = 'r3'",
    );
    db4.close();
    expect(row3?.previous_run_id).toBe("r2");
  }, 60_000);

  it("refuses to publish below the two-pin / two-gateway gate and leaves the run unpublished", async () => {
    const root = mkdtempSync(join(tmpdir(), "pub-gate-"));
    const dataDir = join(root, "data");
    const pubDir = join(root, "publications");
    mkdirSync(join(dataDir, "dataset", "r1", "property"), { recursive: true });
    writeFileSync(join(dataDir, "dataset", "r1", "property", "part-0000.parquet"), "bytes");
    const db = await Duck.open(join(dataDir, "cook_il.duckdb"));
    await ensureRunSchema(db);
    await db.exec(
      "insert into run (run_id, started_at, status, mode) values ('r1', now(), 'ok', 'full')",
    );
    db.close();
    await expect(
      publish({
        runId: "r1",
        dataDir,
        publicationsDir: pubDir,
        verifier: "test",
        env: {},
        gateways: DEAD,
        timeoutMs: 500,
        retries: 0,
        verifyAttempts: 1,
      }),
    ).rejects.toThrow(/publication gate failed: 0\/2 pins .* 0\/2 fully verified gateways/);
    expect(existsSync(join(pubDir, "r1", "manifest.json"))).toBe(false);
    expect(latestPublishedRun(pubDir)).toBeUndefined();
    expect(existsSync(join(dataDir, "publications", "r1", "pending", "rejected.json"))).toBe(true);
    const db2 = await Duck.open(join(dataDir, "cook_il.duckdb"));
    const row = await db2.one<{ root_cid: string | null }>(
      "select root_cid from run where run_id = 'r1'",
    );
    db2.close();
    expect(row?.root_cid).toBeNull();
  }, 60_000);
});

describe("pickRunToPublish", () => {
  const changed = { property: { inserted: 0, updated: 3, unchanged: 7 } };
  const same = { property: { inserted: 0, updated: 0, unchanged: 10 } };
  const all = () => true;
  it("publishes the newest run once any run since the last publication changed data", () => {
    const history = [
      { run_id: "r1", status: "ok", deltas: changed },
      { run_id: "r2", status: "ok", deltas: JSON.stringify(changed) },
      { run_id: "r3", status: "ok", deltas: same },
      { run_id: "r4", status: "failed", deltas: changed },
    ];
    expect(pickRunToPublish(history, "r1", all)).toMatchObject({ runId: "r3" });
    expect(pickRunToPublish(history, "r1", (id) => id !== "r3")).toMatchObject({ runId: "r2" });
  });
  it("skips unchanged refreshes unless forced", () => {
    const history = [
      { run_id: "r1", status: "ok", deltas: changed },
      { run_id: "r2", status: "ok", deltas: same },
    ];
    expect(pickRunToPublish(history, "r1", all)).toEqual({ skip: "no data changes since r1" });
    expect(pickRunToPublish(history, "r1", all, true)).toEqual({ runId: "r2", reason: "forced" });
    expect(pickRunToPublish(history, "r2", all)).toEqual({
      skip: "no completed run newer than r2",
    });
  });
});

describe("pinPublishedManifests", () => {
  it("records each published manifest's identity on sidecar, run row and history; sha256 when unpinned", async () => {
    const root = mkdtempSync(join(tmpdir(), "pin-manifest-"));
    const dataDir = join(root, "data");
    const pubDir = join(root, "publications");
    mkdirSync(join(pubDir, "r1"), { recursive: true });
    const manifest = {
      schema: "cook-il.artifact-manifest.v1",
      run_id: "r1",
      created_at: "2026-11-10T20:00:00Z",
      root_cid: "bafyroot",
      car: { name: "r1.car", size: 0, sha256: "", cid: null },
      previous_run_id: null,
      previous_root_cid: null,
      ipns: null,
      objects: [],
      pins: [],
      origins: [],
    };
    writeFileSync(join(pubDir, "r1", "manifest.json"), JSON.stringify(manifest));
    mkdirSync(dataDir, { recursive: true });
    const db = await Duck.open(join(dataDir, "cook_il.duckdb"));
    await ensureRunSchema(db);
    await db.exec(
      "insert into run (run_id, started_at, status, mode) values ('r1', now(), 'ok', 'full')",
    );
    db.close();
    const sha = sha256Hex(readFileSync(join(pubDir, "r1", "manifest.json")));
    expect(await pinPublishedManifests({ dataDir, publicationsDir: pubDir, env: {} })).toEqual([
      { run_id: "r1", manifest_cid: sha, pinned: [] },
    ]);
    const db2 = await Duck.open(join(dataDir, "cook_il.duckdb"));
    expect(await db2.one("select manifest_cid, root_cid from run where run_id = 'r1'")).toEqual({
      manifest_cid: sha,
      root_cid: "bafyroot",
    });
    db2.close();
    const history = JSON.parse(readFileSync(join(dataDir, "run-history.json"), "utf8")) as {
      run_id: string;
      manifest_cid: string;
    }[];
    expect(history.find((r) => r.run_id === "r1")?.manifest_cid).toBe(sha);
    expect(JSON.parse(readFileSync(join(pubDir, "r1", "run.json"), "utf8"))).toMatchObject({
      manifest_cid: sha,
      manifest_sha256: sha,
      root_cid: "bafyroot",
    });
  }, 60_000);
});
