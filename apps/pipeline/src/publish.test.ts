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
    expect(JSON.parse(readFileSync(join(pubDir, "r2", "run.json"), "utf8"))).toEqual({
      run_id: "r2",
      root_cid: r.manifest.root_cid,
      manifest_cid: r.manifestCid,
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
});
