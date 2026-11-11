// IPFS publication for one pipeline run: build a kubo-compatible UnixFS DAG (CIDv1, raw leaves,
// 256 KiB balanced chunks) so Filebase (CAR import) and Pinata (folder upload) produce the same root CID,
// write a CAR, build the per-run artifact manifest, and verify every object from public gateways.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, posix } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { importer } from "ipfs-unixfs-importer";
import { fixedSize } from "ipfs-unixfs-importer/chunker";
import { balanced } from "ipfs-unixfs-importer/layout";
import { MemoryBlockstore } from "blockstore-core/memory";
import { CarWriter } from "@ipld/car";
import { CID } from "multiformats/cid";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

export const ManifestObject = z.object({
  name: z.string(),
  cid: z.string(),
  size: z.number().int().nonnegative(),
  codec: z.enum(["file", "directory"]),
  sha256: z.string().length(64).nullable(),
});
export const Manifest = z.object({
  schema: z.literal("cook-il.artifact-manifest.v1"),
  run_id: z.string(),
  created_at: z.string(),
  root_cid: z.string(),
  car: z.object({
    name: z.string(),
    size: z.number().int(),
    sha256: z.string(),
    cid: z.string().nullable(),
    /** where the CAR can be downloaded when it is not kept on the serving host (e.g. a GitHub Release asset) */
    release_url: z.string().url().optional(),
  }),
  previous_run_id: z.string().nullable(),
  previous_root_cid: z.string().nullable(),
  ipns: z.object({ name: z.string(), resolved_cid: z.string() }).nullable(),
  objects: z.array(ManifestObject),
  pins: z.array(
    z.object({
      provider: z.string(),
      cid: z.string(),
      at: z.string(),
      ok: z.boolean(),
      detail: z.string().optional(),
    }),
  ),
  origins: z.array(z.string()),
});
export type Manifest = z.infer<typeof Manifest>;

export const GatewayCheck = z.object({
  gateway: z.string(),
  name: z.string(),
  cid: z.string(),
  status: z.number().int(),
  size_match: z.boolean(),
  digest_match: z.boolean(),
  ms: z.number().int(),
  fetched_at: z.string(),
  error: z.string().optional(),
});
export const Verification = z.object({
  run_id: z.string(),
  root_cid: z.string(),
  verified_at: z.string(),
  verifier: z.string(),
  gateways: z.array(z.string()),
  checks: z.array(GatewayCheck),
  summary: z.record(z.string(), z.object({ ok: z.number().int(), total: z.number().int() })),
});
export type Verification = z.infer<typeof Verification>;

/** Independent gateways first, then the gateways of the pinning providers we upload to. */
export const DEFAULT_GATEWAYS = [
  "https://gw.ipfs-lens.dev/ipfs/",
  "https://dget.top/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.filebase.io/ipfs/",
];

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out.sort();
}

export interface Dag {
  rootCid: string;
  objects: z.infer<typeof ManifestObject>[];
  blockstore: MemoryBlockstore;
}

/** Build the DAG for `dir` (its contents become the root directory). */
export async function buildDag(dir: string): Promise<Dag> {
  const files = await listFiles(dir);
  const blockstore = new MemoryBlockstore();
  const entries = await Promise.all(
    files.map(async (f) => ({
      path: posix.join("root", relative(dir, f).split("\\").join("/")),
      content: await readFile(f),
    })),
  );
  const digests = new Map(
    entries.map((e) => [e.path, { sha256: sha256(e.content), size: e.content.length }]),
  );
  const results: { path: string; cid: CID }[] = [];
  for await (const e of importer(entries, blockstore, {
    cidVersion: 1,
    rawLeaves: true,
    wrapWithDirectory: true,
    chunker: fixedSize({ chunkSize: 262_144 }),
    layout: balanced(),
  })) {
    results.push({ path: e.path ?? "", cid: e.cid });
  }
  const root = results.find((r) => r.path === "root");
  if (!root) throw new Error("root directory not produced");
  const objects = results
    .filter((r) => r.path !== "root" && r.path !== "")
    .map((r) => {
      const name = r.path.replace(/^root\//, "");
      const d = digests.get(r.path);
      const isDir = !d;
      return {
        name,
        cid: r.cid.toString(),
        size: d?.size ?? 0,
        codec: isDir ? ("directory" as const) : ("file" as const),
        sha256: d?.sha256 ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rootCid: root.cid.toString(), objects, blockstore };
}

/** Write a CAR of the DAG rooted at rootCid. Returns size and sha256 of the CAR bytes. */
export async function writeCar(
  dag: Dag,
  carPath: string,
): Promise<{ size: number; sha256: string }> {
  const root = CID.parse(dag.rootCid);
  const { writer, out } = CarWriter.create([root]);
  const hash = createHash("sha256");
  let size = 0;
  const sink = createWriteStream(carPath);
  const pump = pipeline(
    Readable.from(
      (async function* () {
        for await (const chunk of out) {
          hash.update(chunk);
          size += chunk.length;
          yield chunk;
        }
      })(),
    ),
    sink,
  );
  for await (const pair of dag.blockstore.getAll()) {
    const chunks: Uint8Array[] = [];
    for await (const c of pair.bytes) chunks.push(c);
    await writer.put({ cid: pair.cid, bytes: Buffer.concat(chunks) });
  }
  await writer.close();
  await pump;
  return { size, sha256: hash.digest("hex") };
}

export interface FilebaseConfig {
  accessKey: string;
  secretKey: string;
  bucket: string;
}
/** Import the CAR into Filebase; returns the CID Filebase computed (must equal the local root). */
export async function pinFilebase(
  cfg: FilebaseConfig,
  carPath: string,
  key: string,
): Promise<string> {
  const s3 = new S3Client({
    endpoint: "https://s3.filebase.com",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: await readFile(carPath),
      Metadata: { import: "car" },
    }),
  );
  const head = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const cid = head.Metadata?.["cid"];
  if (!cid) throw new Error("Filebase returned no cid metadata");
  return cid;
}

/** Upload the directory to Pinata as a folder (same DAG layout => same root CID). */
export async function pinPinata(jwt: string, dir: string, name: string): Promise<string> {
  const files = await listFiles(dir);
  const fd = new FormData();
  for (const f of files)
    fd.append(
      "file",
      new File([await readFile(f)], posix.join("root", relative(dir, f).split("\\").join("/"))),
    );
  fd.append("network", "public");
  fd.append("name", name);
  const r = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: fd,
  });
  const body = (await r.json().catch(() => ({}))) as { data?: { cid?: string }; error?: unknown };
  if (!r.ok || !body.data?.cid)
    throw new Error(
      `Pinata upload failed: ${r.status} ${JSON.stringify(body.error ?? body).slice(0, 200)}`,
    );
  return body.data.cid;
}

type Pin = Manifest["pins"][number];

/** Single-file UnixFS DAG with the dataset's importer settings (CIDv1, raw leaves, 256 KiB chunks). */
export async function fileDag(bytes: Uint8Array): Promise<Dag> {
  const blockstore = new MemoryBlockstore();
  let cid: CID | undefined;
  for await (const e of importer([{ content: bytes }], blockstore, {
    cidVersion: 1,
    rawLeaves: true,
    chunker: fixedSize({ chunkSize: 262_144 }),
    layout: balanced(),
  }))
    cid = e.cid;
  if (!cid) throw new Error("file CID not produced");
  return { rootCid: cid.toString(), objects: [], blockstore };
}

/** Upload one file to Pinata (reusing an existing upload with the same name and CID). */
export async function pinPinataFile(jwt: string, bytes: Uint8Array, name: string): Promise<string> {
  const headers = { Authorization: `Bearer ${jwt}` };
  const list = await fetch(
    `https://api.pinata.cloud/v3/files/public?name=${encodeURIComponent(name)}&limit=100`,
    { headers },
  );
  if (list.ok) {
    const body = (await list.json()) as {
      data?: { files?: { name: string | null; cid: string }[] };
    };
    const existing = body.data?.files?.find((f) => f.name === name);
    if (existing) return existing.cid;
  }
  const fd = new FormData();
  fd.append("file", new File([bytes], "manifest.json", { type: "application/json" }));
  fd.append("network", "public");
  fd.append("name", name);
  const r = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers,
    body: fd,
  });
  const body = (await r.json().catch(() => ({}))) as { data?: { cid?: string }; error?: unknown };
  if (!r.ok || !body.data?.cid)
    throw new Error(
      `Pinata upload failed: ${r.status} ${JSON.stringify(body.error ?? body).slice(0, 200)}`,
    );
  return body.data.cid;
}

/**
 * Pin a run's manifest.json itself so its identity is a real IPFS CID instead of a sha256 stand-in:
 * Filebase imports a one-file CAR, Pinata uploads the file. Each pin is ok only when the provider's
 * CID equals the locally computed one.
 */
export async function pinManifest(o: {
  runId: string;
  manifestBytes: Uint8Array;
  carPath: string;
  filebase: FilebaseConfig | null;
  pinataJwt: string | null;
}): Promise<{ cid: string; sha256: string; pins: Pin[] }> {
  const dag = await fileDag(o.manifestBytes);
  await writeCar(dag, o.carPath);
  const pins: Pin[] = [];
  const attempt = async (provider: string, run: () => Promise<string>, how: string) => {
    try {
      const cid = await run();
      pins.push({
        provider,
        cid,
        at: new Date().toISOString(),
        ok: cid === dag.rootCid,
        detail:
          cid === dag.rootCid ? `${how}, CID matches local manifest CID` : `CID mismatch: ${cid}`,
      });
    } catch (e) {
      pins.push({
        provider,
        cid: dag.rootCid,
        at: new Date().toISOString(),
        ok: false,
        detail: String(e).slice(0, 200),
      });
    }
  };
  if (o.filebase) {
    const cfg = o.filebase;
    await attempt(
      "filebase",
      () => pinFilebase(cfg, o.carPath, `runs/${o.runId}/manifest.car`),
      "CAR import",
    );
  }
  if (o.pinataJwt) {
    const jwt = o.pinataJwt;
    await attempt(
      "pinata",
      () => pinPinataFile(jwt, o.manifestBytes, `manifest-cook-il-${o.runId}`),
      "file upload",
    );
  }
  return { cid: dag.rootCid, sha256: sha256(o.manifestBytes), pins };
}

/** Fetch every file object from every gateway and compare size and sha256. */
export async function verify(opts: {
  runId: string;
  rootCid: string;
  objects: Manifest["objects"];
  gateways?: string[];
  verifier: string;
  timeoutMs?: number;
  retries?: number;
}): Promise<Verification> {
  const gateways = opts.gateways ?? DEFAULT_GATEWAYS;
  const files = opts.objects.filter((o) => o.codec === "file");
  const retries = opts.retries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  // Gateways are independent operators: check them concurrently, each one sequentially.
  const perGateway = await Promise.all(
    gateways.map(async (gw) => {
      const checks: z.infer<typeof GatewayCheck>[] = [];
      // After three consecutive rate-limit/timeout failures on one gateway, record the rest as skipped.
      let consecutiveFailures = 0;
      for (const o of files) {
        const url = `${gw}${opts.rootCid}/${o.name}`;
        let last: z.infer<typeof GatewayCheck> | undefined;
        if (consecutiveFailures >= 3) {
          checks.push({
            gateway: gw,
            name: o.name,
            cid: o.cid,
            status: 0,
            size_match: false,
            digest_match: false,
            ms: 0,
            fetched_at: new Date().toISOString(),
            error: "skipped: gateway rate-limited or unreachable on 3 consecutive objects",
          });
          continue;
        }
        for (let attempt = 0; attempt <= retries; attempt++) {
          const t0 = Date.now();
          try {
            const r = await fetch(url, {
              headers: { "user-agent": "cook-il-pipeline-verify/1.0" },
              signal: AbortSignal.timeout(timeoutMs),
            });
            const buf = new Uint8Array(await r.arrayBuffer());
            last = {
              gateway: gw,
              name: o.name,
              cid: o.cid,
              status: r.status,
              size_match: r.status === 200 && buf.length === o.size,
              digest_match: r.status === 200 && sha256(buf) === o.sha256,
              ms: Date.now() - t0,
              fetched_at: new Date().toISOString(),
            };
            if (last.digest_match || (r.status !== 429 && r.status < 500)) break;
          } catch (e) {
            last = {
              gateway: gw,
              name: o.name,
              cid: o.cid,
              status: 0,
              size_match: false,
              digest_match: false,
              ms: Date.now() - t0,
              fetched_at: new Date().toISOString(),
              error: String(e).slice(0, 120),
            };
          }
          if (attempt < retries) await new Promise((res) => setTimeout(res, 5_000 * (attempt + 1)));
        }
        if (last) {
          checks.push(last);
          const rateLimited = last.status === 429 || last.status === 0 || last.status >= 500;
          consecutiveFailures = rateLimited ? consecutiveFailures + 1 : 0;
        }
      }
      return checks;
    }),
  );
  const checks = perGateway.flat();
  const summary: Record<string, { ok: number; total: number }> = {};
  for (const c of checks) {
    summary[c.gateway] ??= { ok: 0, total: 0 };
    summary[c.gateway]!.total++;
    if (c.size_match && c.digest_match) summary[c.gateway]!.ok++;
  }
  return {
    run_id: opts.runId,
    root_cid: opts.rootCid,
    verified_at: new Date().toISOString(),
    verifier: opts.verifier,
    gateways,
    checks,
    summary,
  };
}

/** Gateways that returned every file object with matching size and sha256. */
export function fullyVerifiedGateways(v: Pick<Verification, "summary">): string[] {
  return Object.entries(v.summary)
    .filter(([, s]) => s.total > 0 && s.ok === s.total)
    .map(([gw]) => gw);
}

/**
 * Pinata's free tier holds one full snapshot: before uploading a new one, unpin earlier uploads
 * whose name starts with `prefix`. Older snapshots stay pinned on Filebase and as CAR releases.
 */
export async function prunePinata(jwt: string, prefix: string): Promise<string[]> {
  const headers = { Authorization: `Bearer ${jwt}` };
  const r = await fetch("https://api.pinata.cloud/v3/files/public?limit=100", { headers });
  if (!r.ok) throw new Error(`Pinata list failed: ${r.status}`);
  const body = (await r.json()) as { data?: { files?: { id: string; name: string | null }[] } };
  const removed: string[] = [];
  for (const f of body.data?.files ?? []) {
    if (!f.name?.startsWith(prefix)) continue;
    const d = await fetch(`https://api.pinata.cloud/v3/files/public/${f.id}`, {
      method: "DELETE",
      headers,
    });
    if (!d.ok) throw new Error(`Pinata unpin of ${f.name} failed: ${d.status}`);
    removed.push(f.name);
  }
  return removed;
}

export interface PublishOptions {
  runId: string;
  datasetDir: string;
  outDir: string; // publications/<run_id> (manifest.json, verification.json; committed)
  carDir?: string; // where the CAR goes (default outDir); keep large CARs out of the repo
  previous: { runId: string; rootCid: string } | null;
  carReleaseUrl?: string;
  filebase: FilebaseConfig | null;
  pinataJwt: string | null;
  gateways?: string[];
  verifier: string;
  timeoutMs?: number;
  retries?: number;
}

/** Full publication of one run. Writes <outDir>/manifest.json, <outDir>/verification.json and <carDir>/<run_id>.car. */
export async function publishRun(
  o: PublishOptions,
): Promise<{ manifest: Manifest; verification: Verification; carPath: string }> {
  const dag = await buildDag(o.datasetDir);
  const carPath = join(o.carDir ?? o.outDir, `${o.runId}.car`);
  const car = await writeCar(dag, carPath);
  const pins: Manifest["pins"] = [];
  if (o.filebase) {
    try {
      const cid = await pinFilebase(o.filebase, carPath, `runs/${o.runId}/${o.runId}.car`);
      pins.push({
        provider: "filebase",
        cid,
        at: new Date().toISOString(),
        ok: cid === dag.rootCid,
        detail: cid === dag.rootCid ? "CAR import, CID matches local root" : `CID mismatch: ${cid}`,
      });
    } catch (e) {
      pins.push({
        provider: "filebase",
        cid: dag.rootCid,
        at: new Date().toISOString(),
        ok: false,
        detail: String(e).slice(0, 200),
      });
    }
  } else
    pins.push({
      provider: "filebase",
      cid: dag.rootCid,
      at: new Date().toISOString(),
      ok: false,
      detail: "skipped: FILEBASE_ACCESS_KEY / FILEBASE_SECRET_KEY / FILEBASE_BUCKET not configured",
    });
  if (o.pinataJwt) {
    try {
      const unpinned = await prunePinata(o.pinataJwt, "cook-il-");
      const cid = await pinPinata(o.pinataJwt, o.datasetDir, `cook-il-${o.runId}`);
      pins.push({
        provider: "pinata",
        cid,
        at: new Date().toISOString(),
        ok: cid === dag.rootCid,
        detail:
          (cid === dag.rootCid ? "folder upload, CID matches local root" : `CID mismatch: ${cid}`) +
          (unpinned.length ? `; free-tier retention unpinned ${unpinned.join(", ")}` : ""),
      });
    } catch (e) {
      pins.push({
        provider: "pinata",
        cid: dag.rootCid,
        at: new Date().toISOString(),
        ok: false,
        detail: String(e).slice(0, 200),
      });
    }
  } else
    pins.push({
      provider: "pinata",
      cid: dag.rootCid,
      at: new Date().toISOString(),
      ok: false,
      detail: "skipped: PINATA_JWT not configured",
    });
  const manifest: Manifest = {
    schema: "cook-il.artifact-manifest.v1",
    run_id: o.runId,
    created_at: new Date().toISOString(),
    root_cid: dag.rootCid,
    car: {
      name: `${o.runId}.car`,
      size: car.size,
      sha256: car.sha256,
      cid: null,
      ...(o.carReleaseUrl ? { release_url: o.carReleaseUrl } : {}),
    },
    previous_run_id: o.previous?.runId ?? null,
    previous_root_cid: o.previous?.rootCid ?? null,
    ipns: null,
    objects: [
      { name: ".", cid: dag.rootCid, size: 0, codec: "directory", sha256: null },
      ...dag.objects,
    ],
    pins,
    origins: [],
  };
  await writeFile(
    join(o.outDir, "manifest.json"),
    JSON.stringify(Manifest.parse(manifest), null, 2),
  );
  const verification = await verify({
    runId: o.runId,
    rootCid: dag.rootCid,
    objects: manifest.objects,
    ...(o.gateways ? { gateways: o.gateways } : {}),
    ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
    ...(o.retries !== undefined ? { retries: o.retries } : {}),
    verifier: o.verifier,
  });
  await writeFile(join(o.outDir, "verification.json"), JSON.stringify(verification, null, 2));
  return { manifest, verification, carPath };
}

export async function fileSize(p: string): Promise<number> {
  return (await stat(p)).size;
}
