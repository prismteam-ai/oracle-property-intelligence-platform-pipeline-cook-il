import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Duck } from "@cook/duck";
import type { Delta } from "@cook/shared";
import { openForWrite } from "./db.js";
import { log } from "./log.js";
import { exportRunHistory } from "./run.js";
import {
  Manifest,
  fullyVerifiedGateways,
  pinManifest,
  publishRun,
  verify,
  type Verification,
} from "@cook/ipfs-publish";

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
  /** durability gate: successful pins required (default 2: Filebase + Pinata) */
  minPins?: number;
  /** availability gate: gateways that must return every object with matching digest (default 2) */
  minVerifiedGateways?: number;
  /** verification rounds while new content propagates to gateways (default 3) */
  verifyAttempts?: number;
  verifyWaitMs?: number;
}

export const MIN_PINS = 2;
export const MIN_VERIFIED_GATEWAYS = 2;

/** Sidecar next to manifest.json so the web can show the run's CIDs without opening the DuckDB file. */
export interface RunSidecar {
  run_id: string;
  root_cid: string;
  /** UnixFS CID of manifest.json when at least one pin matched it, else its sha256 (manifest not pinned) */
  manifest_cid: string;
  manifest_sha256?: string;
  manifest_pins?: Manifest["pins"];
  previous_run_id: string | null;
  previous_root_cid: string | null;
}

const pinConfig = (env: z.infer<typeof PublishEnv>) => ({
  filebase:
    env.FILEBASE_ACCESS_KEY && env.FILEBASE_SECRET_KEY && env.FILEBASE_BUCKET
      ? {
          accessKey: env.FILEBASE_ACCESS_KEY,
          secretKey: env.FILEBASE_SECRET_KEY,
          bucket: env.FILEBASE_BUCKET,
        }
      : null,
  pinataJwt: env.PINATA_JWT ?? null,
});

/**
 * Pin <publicationsDir>/<run_id>/manifest.json itself and write the run.json sidecar. manifest_cid is the
 * manifest's UnixFS CID when a provider pinned exactly that CID; without any matching pin it stays the
 * sha256 of the manifest bytes. The manifest bytes are never changed.
 */
export async function recordManifestCid(o: {
  runId: string;
  dataDir: string;
  publicationsDir: string;
  env?: NodeJS.ProcessEnv;
}): Promise<RunSidecar> {
  const outDir = join(o.publicationsDir, o.runId);
  const bytes = readFileSync(join(outDir, "manifest.json"));
  const manifest = Manifest.parse(JSON.parse(bytes.toString("utf8")));
  const carDir = join(o.dataDir, "publications", o.runId);
  mkdirSync(carDir, { recursive: true });
  const r = await pinManifest({
    runId: o.runId,
    manifestBytes: bytes,
    carPath: join(carDir, "manifest.car"),
    ...pinConfig(PublishEnv.parse(o.env ?? process.env)),
  });
  const sidecar: RunSidecar = {
    run_id: o.runId,
    root_cid: manifest.root_cid,
    manifest_cid: r.pins.some((p) => p.ok) ? r.cid : r.sha256,
    manifest_sha256: r.sha256,
    manifest_pins: r.pins,
    previous_run_id: manifest.previous_run_id,
    previous_root_cid: manifest.previous_root_cid,
  };
  writeFileSync(join(outDir, "run.json"), JSON.stringify(sidecar, null, 2));
  return sidecar;
}

/** Give every already published run a pinned manifest CID (sidecars, run rows and run history). */
export async function pinPublishedManifests(o: {
  dataDir: string;
  publicationsDir: string;
  runIds?: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<{ run_id: string; manifest_cid: string; pinned: string[] }[]> {
  const ids =
    o.runIds ??
    (existsSync(o.publicationsDir)
      ? readdirSync(o.publicationsDir)
          .filter((d) => existsSync(join(o.publicationsDir, d, "manifest.json")))
          .sort()
      : []);
  const out: RunSidecar[] = [];
  for (const runId of ids) out.push(await recordManifestCid({ ...o, runId }));
  await withDb(join(o.dataDir, "cook_il.duckdb"), async (db) => {
    for (const s of out)
      await db.exec(
        "update run set manifest_cid = ?, root_cid = coalesce(root_cid, ?) where run_id = ?",
        [s.manifest_cid, s.root_cid, s.run_id],
      );
    await exportRunHistory(db, o.dataDir);
  });
  return out.map((s) => ({
    run_id: s.run_id,
    manifest_cid: s.manifest_cid,
    pinned: (s.manifest_pins ?? []).filter((p) => p.ok).map((p) => p.provider),
  }));
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

/**
 * Build DAG + CAR for data/dataset/<run_id>, pin, verify, then record root_cid / manifest_cid on the run.
 * The publication is staged under <dataDir>/publications/<run_id>/pending and only becomes a published
 * manifest when at least `minPins` pins succeeded and `minVerifiedGateways` gateways returned every
 * object intact; otherwise it stays pending with rejected.json and the command fails. The DuckDB write
 * lock is held only for the short reads/writes at both ends, so ingestion runs are never blocked by
 * uploads or gateway verification.
 */
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
  const pendingDir = join(carDir, "pending");
  rmSync(pendingDir, { recursive: true, force: true });
  mkdirSync(pendingDir, { recursive: true });
  const dbPath = join(o.dataDir, "cook_il.duckdb");

  const { prevId, prev } = await withDb(dbPath, async (db) => {
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
    return { prevId, prev };
  });
  const { filebase, pinataJwt } = pinConfig(env);
  const verifyOpts = {
    ...(o.gateways ? { gateways: o.gateways } : {}),
    ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
    ...(o.retries !== undefined ? { retries: o.retries } : {}),
  };
  const r = await publishRun({
    runId: o.runId,
    datasetDir,
    outDir: pendingDir,
    carDir,
    previous: previousRootCid(o.publicationsDir, prev, prevId),
    ...(o.carUrl ? { carReleaseUrl: o.carUrl } : {}),
    filebase,
    pinataJwt,
    verifier: o.verifier,
    ...verifyOpts,
  });

  const minPins = o.minPins ?? MIN_PINS;
  const minGateways = o.minVerifiedGateways ?? MIN_VERIFIED_GATEWAYS;
  let verification = r.verification;
  for (
    let attempt = 1;
    attempt < (o.verifyAttempts ?? 3) && fullyVerifiedGateways(verification).length < minGateways;
    attempt++
  ) {
    log.info({ run_id: o.runId, attempt }, "gateways still propagating; verifying again");
    await new Promise((res) => setTimeout(res, o.verifyWaitMs ?? 180_000));
    verification = await verify({
      runId: o.runId,
      rootCid: r.manifest.root_cid,
      objects: r.manifest.objects,
      verifier: o.verifier,
      ...verifyOpts,
    });
    writeFileSync(join(pendingDir, "verification.json"), JSON.stringify(verification, null, 2));
  }
  const pinsOk = r.manifest.pins.filter((p) => p.ok).map((p) => p.provider);
  const gatewaysOk = fullyVerifiedGateways(verification);
  if (pinsOk.length < minPins || gatewaysOk.length < minGateways) {
    const reason = `publication gate failed: ${pinsOk.length}/${minPins} pins (${pinsOk.join(", ") || "none"}), ${gatewaysOk.length}/${minGateways} fully verified gateways`;
    writeFileSync(
      join(pendingDir, "rejected.json"),
      JSON.stringify({ run_id: o.runId, rejected_at: new Date().toISOString(), reason }, null, 2),
    );
    throw new Error(`${reason}; staged in ${pendingDir}, not published`);
  }

  mkdirSync(outDir, { recursive: true });
  for (const f of ["manifest.json", "verification.json"])
    copyFileSync(join(pendingDir, f), join(outDir, f));
  rmSync(pendingDir, { recursive: true, force: true });
  const sidecar = await recordManifestCid({
    runId: o.runId,
    dataDir: o.dataDir,
    publicationsDir: o.publicationsDir,
    ...(o.env ? { env: o.env } : {}),
  });
  const manifestCid = sidecar.manifest_cid;
  await withDb(dbPath, async (db) => {
    await db.exec(
      "update run set root_cid = ?, manifest_cid = ?, previous_run_id = ? where run_id = ?",
      [r.manifest.root_cid, manifestCid, r.manifest.previous_run_id, o.runId],
    );
    await exportRunHistory(db, o.dataDir);
  });
  return { ...r, verification, manifestCid };
}

async function withDb<T>(dbPath: string, f: (db: Duck) => Promise<T>): Promise<T> {
  const db = await openForWrite(dbPath, log);
  try {
    return await f(db);
  } finally {
    db.close();
  }
}

type HistoryRow = { run_id: string; status: string; deltas: unknown };

/**
 * Pick the run to publish: the newest ok run newer than the last publication that still has its
 * dataset, but only when some run since that publication changed data (inserted/updated rows).
 * Unchanged refreshes are recorded in run history and never re-upload an identical snapshot.
 */
export function pickRunToPublish(
  history: readonly HistoryRow[],
  lastPublished: string | undefined,
  hasDataset: (runId: string) => boolean,
  force = false,
): { runId: string; reason: string } | { skip: string } {
  const newer = history
    .filter((r) => r.status === "ok" && (!lastPublished || r.run_id > lastPublished))
    .sort((a, b) => a.run_id.localeCompare(b.run_id));
  const candidate = [...newer].reverse().find((r) => hasDataset(r.run_id));
  if (!candidate) return { skip: `no completed run newer than ${lastPublished ?? "nothing"}` };
  const changed = newer.filter((r) => {
    const deltas = (typeof r.deltas === "string" ? JSON.parse(r.deltas) : r.deltas) as Record<
      string,
      Partial<Delta>
    > | null;
    return Object.values(deltas ?? {}).some((d) => (d.inserted ?? 0) + (d.updated ?? 0) > 0);
  });
  if (!changed.length && !force)
    return { skip: `no data changes since ${lastPublished ?? "the first run"}` };
  return {
    runId: candidate.run_id,
    reason: force
      ? "forced"
      : `data changed in ${changed.map((r) => r.run_id).join(", ")} since ${lastPublished ?? "nothing"}`,
  };
}

/** Scheduled publisher: publish the newest changed run, independently of the ingestion loop. */
export async function publishLatest(
  o: Omit<PublishOpts, "runId" | "previous"> & { force?: boolean },
): Promise<{ published: string | null; reason: string; root_cid?: string }> {
  const lockDir = join(o.dataDir, "publications");
  mkdirSync(lockDir, { recursive: true });
  const lock = join(lockDir, ".publish.lock");
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < 3 * 3600_000)
    return { published: null, reason: "another publication is in progress" };
  writeFileSync(lock, String(process.pid));
  try {
    const historyPath = join(o.dataDir, "run-history.json");
    if (!existsSync(historyPath)) return { published: null, reason: "no run history yet" };
    const history = JSON.parse(readFileSync(historyPath, "utf8")) as HistoryRow[];
    const last = latestPublishedRun(o.publicationsDir);
    const pick = pickRunToPublish(
      history,
      last,
      (id) => existsSync(join(o.dataDir, "dataset", id, "property")),
      o.force,
    );
    if ("skip" in pick) return { published: null, reason: pick.skip };
    log.info({ run_id: pick.runId, reason: pick.reason }, "publishing");
    const r = await publish({ ...o, runId: pick.runId, previous: last });
    return { published: pick.runId, reason: pick.reason, root_cid: r.manifest.root_cid };
  } finally {
    rmSync(lock, { force: true });
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
