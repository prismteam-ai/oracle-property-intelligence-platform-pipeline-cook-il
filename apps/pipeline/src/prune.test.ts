import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { prune } from "./prune.js";

const log = pino({ level: "silent" });
let root: string;
let dataDir: string;
let pubDir: string;

function runDir(id: string, bytes = 10) {
  const d = join(dataDir, "dataset", id, "permit");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "part.parquet"), "x".repeat(bytes));
}
function rawBatch(source: string, batch: string) {
  const d = join(dataDir, "raw", source, batch);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "page-00000.ndjson"), "{}\n");
}
const hasRun = (id: string) => existsSync(join(dataDir, "dataset", id));
const hasBatch = (s: string, b: string) => existsSync(join(dataDir, "raw", s, b));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prune-"));
  dataDir = join(root, "data");
  pubDir = join(root, "publications");
  runDir("20260101T000000Z", 5); // published, oldest
  runDir("20260102T000000Z", 7); // unpublished old -> deleted
  runDir("20260103T000000Z", 9); // unpublished old -> deleted
  runDir("20260104T000000Z"); // newest 2 -> kept
  runDir("20260105T000000Z");
  mkdirSync(join(pubDir, "20260101T000000Z"), { recursive: true });
  writeFileSync(join(pubDir, "20260101T000000Z", "manifest.json"), "{}");
  for (const b of ["full", "inc-a", "inc-b", "inc-c", "inc-d", "inc-e"]) rawBatch("cook_sales", b);
  rawBatch("idfpr_roofing", "full");
  rawBatch("idfpr_roofing", "inc-a");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("prune", () => {
  it("keeps published + newest N, deletes the rest, prunes old inc batches", () => {
    const r = prune({ dataDir, publicationsDir: pubDir, log });
    expect(r.deleted.map((d) => d.run_id)).toEqual(["20260103T000000Z", "20260102T000000Z"]);
    expect(r.deleted.map((d) => d.bytes)).toEqual([9, 7]);
    expect(r.kept).toEqual(["20260105T000000Z", "20260104T000000Z", "20260101T000000Z"]);
    expect(hasRun("20260101T000000Z")).toBe(true);
    expect(hasRun("20260102T000000Z")).toBe(false);
    expect(hasRun("20260105T000000Z")).toBe(true);
    expect(r.raw_deleted.map((x) => x.batch)).toEqual(["inc-b", "inc-a"]);
    expect(hasBatch("cook_sales", "full")).toBe(true);
    expect(hasBatch("cook_sales", "inc-c")).toBe(true);
    expect(hasBatch("cook_sales", "inc-a")).toBe(false);
    expect(hasBatch("idfpr_roofing", "inc-a")).toBe(true);
    expect(r.bytes_freed).toBe(9 + 7 + 2 * 3);
  });

  it("never deletes the current run, honours --keep", () => {
    const r = prune({
      dataDir,
      publicationsDir: pubDir,
      keep: 1,
      currentRunId: "20260102T000000Z",
      log,
    });
    expect(r.deleted.map((d) => d.run_id)).toEqual(["20260104T000000Z", "20260103T000000Z"]);
    expect(hasRun("20260102T000000Z")).toBe(true);
    expect(hasRun("20260105T000000Z")).toBe(true);
  });

  it("dry-run deletes nothing but reports", () => {
    const r = prune({ dataDir, publicationsDir: pubDir, dryRun: true, log });
    expect(r.dry_run).toBe(true);
    expect(r.deleted).toHaveLength(2);
    expect(r.raw_deleted).toHaveLength(2);
    expect(hasRun("20260102T000000Z")).toBe(true);
    expect(hasBatch("cook_sales", "inc-a")).toBe(true);
  });

  it("is a no-op on a missing data dir", () => {
    const r = prune({ dataDir: join(root, "nope"), publicationsDir: pubDir, log });
    expect(r.deleted).toEqual([]);
    expect(r.bytes_freed).toBe(0);
  });
});
