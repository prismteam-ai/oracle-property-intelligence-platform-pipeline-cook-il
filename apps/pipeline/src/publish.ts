import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openForWrite } from "./db.js";
import { log } from "./log.js";
import { Manifest, publishRun, verify, type Verification } from "@cook/ipfs-publish";

/** Pinning credentials are optional: a provider without them is skipped and recorded in `pins`. */
const PublishEnv = z.object({
  FILEBASE_ACCESS_KEY: z.string().min(1).optional(),
  FILEBASE_SECRET_KEY: z.string().min(1).optional(),
  FILEBASE_BUCKET: z.string().min(1).optional(),
  PINATA_JWT: z.string().min(1).optional(),
});

export interface PublishOpts {
  runId: string;
  previous?: string | undefined;
  dataDir: string;
  /** repo `publications/`: manifest.json + verification.json are committed; the CAR goes to <dataDir>/publications */
  publicationsDir: string;
  verifier: string;
  /** recorded as manifest.car.release_url (the CAR itself is not committed) */
  carUrl?: string | undefined;
  env?: NodeJS.ProcessEnv;
  gateways?: string[];
  timeoutMs?: number;
  retries?: number;
}

/** Sidecar next to manifest.json so the web can show the run's CIDs without opening the DuckDB file. */
export interface RunSidecar {
  run_id: string;
  root_cid: string;
  manifest_cid: string;
  previous_run_id: string | null;
  previous_root_cid: string | null;
}

/** Root CID of a previous run: its run row, else its committed manifest.json (the row may live in another DB copy). */
function previousRootCid(
  publicationsDir: string,
  prev: { run_id: string; root_cid: string | null } | undefined,
  prevId: string | null,
): { runId: string; rootCid: string } | null {
  if (prev?.root_cid) return { runId: prev.run_id, rootCid: prev.root_cid };
  if (!prevId) return null;
  const f = join(publicationsDir, prevId, "manifest.json");
  if (!existsSync(f)) return null;
  const m = Manifest.parse(JSON.parse(readFileSync(f, "utf8")));
  return { runId: m.run_id, rootCid: m.root_cid };
}

export const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Build DAG + CAR for data/dataset/<run_id>, pin, verify, then record root_cid / manifest_cid on the run row. */
export async function publish(o: PublishOpts): Promise<{
  manifest: Manifest;
  verification: Verification;
  carPath: string;
  manifestCid: string;
}> {
  const env = PublishEnv.parse(o.env ?? process.env);
  const datasetDir = join(o.dataDir, "dataset", o.runId);
  if (!existsSync(datasetDir))
    throw new Error(`no dataset directory for run ${o.runId}: ${datasetDir}`);
  const outDir = join(o.publicationsDir, o.runId);
  const carDir = join(o.dataDir, "publications", o.runId);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(carDir, { recursive: true });

  const db = await openForWrite(join(o.dataDir, "cook_il.duckdb"), log);
  try {
    const run = await db.one<{ previous_run_id: string | null }>(
      "select previous_run_id from run where run_id = ?",
      [o.runId],
    );
    if (!run) throw new Error(`run ${o.runId} not found`);
    const prevId = o.previous ?? run.previous_run_id ?? null;
    const prev = prevId
      ? await db.one<{ run_id: string; root_cid: string | null }>(
          "select run_id, root_cid from run where run_id = ?",
          [prevId],
        )
      : undefined;
    const filebase =
      env.FILEBASE_ACCESS_KEY && env.FILEBASE_SECRET_KEY && env.FILEBASE_BUCKET
        ? {
            accessKey: env.FILEBASE_ACCESS_KEY,
            secretKey: env.FILEBASE_SECRET_KEY,
            bucket: env.FILEBASE_BUCKET,
          }
        : null;
    const r = await publishRun({
      runId: o.runId,
      datasetDir,
      outDir,
      carDir,
      previous: previousRootCid(o.publicationsDir, prev, prevId),
      ...(o.carUrl ? { carReleaseUrl: o.carUrl } : {}),
      filebase,
      pinataJwt: env.PINATA_JWT ?? null,
      verifier: o.verifier,
      ...(o.gateways ? { gateways: o.gateways } : {}),
      ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
      ...(o.retries !== undefined ? { retries: o.retries } : {}),
    });
    // manifest_cid: sha256 of the committed manifest.json for now (the manifest itself is not pinned yet).
    const manifestCid = sha256Hex(readFileSync(join(outDir, "manifest.json")));
    const sidecar: RunSidecar = {
      run_id: o.runId,
      root_cid: r.manifest.root_cid,
      manifest_cid: manifestCid,
      previous_run_id: r.manifest.previous_run_id,
      previous_root_cid: r.manifest.previous_root_cid,
    };
    writeFileSync(join(outDir, "run.json"), JSON.stringify(sidecar, null, 2));
    await db.exec(
      "update run set root_cid = ?, manifest_cid = ?, previous_run_id = ? where run_id = ?",
      [r.manifest.root_cid, manifestCid, r.manifest.previous_run_id, o.runId],
    );
    return { ...r, manifestCid };
  } finally {
    db.close();
  }
}

/** Latest run id under publications/ that has a manifest.json. */
export function latestPublishedRun(publicationsDir: string): string | undefined {
  if (!existsSync(publicationsDir)) return undefined;
  return readdirSync(publicationsDir)
    .filter((d) => existsSync(join(publicationsDir, d, "manifest.json")))
    .sort()
    .at(-1);
}

/** Re-verify a committed manifest from public gateways; writes verification-<verifier>.json next to it. */
export async function verifyPublished(o: {
  runId: string;
  publicationsDir: string;
  verifier: string;
  gateways?: string[];
  timeoutMs?: number;
  retries?: number;
}): Promise<{ verification: Verification; file: string }> {
  const dir = join(o.publicationsDir, o.runId);
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
  const verification = await verify({
    runId: manifest.run_id,
    rootCid: manifest.root_cid,
    objects: manifest.objects,
    verifier: o.verifier,
    ...(o.gateways ? { gateways: o.gateways } : {}),
    ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
    ...(o.retries !== undefined ? { retries: o.retries } : {}),
  });
  const safe = o.verifier.replace(/[^\w.-]+/g, "-");
  const file = join(dir, `verification-${safe}.json`);
  writeFileSync(file, JSON.stringify(verification, null, 2));
  return { verification, file };
}
