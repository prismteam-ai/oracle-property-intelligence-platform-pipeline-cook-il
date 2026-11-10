import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duck } from "@cook/duck";
import { ensureRunSchema } from "./run.js";
import { latestPublishedRun, publish, sha256Hex, verifyPublished } from "./publish.js";

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
      "insert into run (run_id, started_at, status, mode, root_cid, previous_run_id) values ('r1', now(), 'ok', 'full', 'bafyprev', null), ('r2', now(), 'ok', 'incremental', null, 'r1')",
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
  }, 30_000);
});
