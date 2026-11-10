import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_GATEWAYS,
  ManifestSchema,
  VerificationSchema,
  type Manifest,
  type Verification,
} from "./contract.js";

export const GATEWAYS = DEFAULT_GATEWAYS; // "https://ipfs.io/ipfs/" style prefixes

/** Gateways run by the pinning providers we use; everything else is an independent third party. */
export const PINNING_PROVIDER_GATEWAYS = [
  "https://gateway.pinata.cloud",
  "https://ipfs.filebase.io",
];
export type GatewayKind = "independent" | "pinning provider";
export const gatewayKind = (gateway: string): GatewayKind =>
  PINNING_PROVIDER_GATEWAYS.some((g) => gateway.startsWith(g)) ? "pinning provider" : "independent";

/** URL of a CID (optionally a path below it) on every default gateway. */
export function gatewayUrls(
  cid: string,
  path?: string,
): { gateway: string; kind: GatewayKind; url: string }[] {
  return GATEWAYS.map((g) => ({
    gateway: new URL(g).origin,
    kind: gatewayKind(g),
    url: `${g}${cid}${path ? `/${path}` : ""}`,
  }));
}

/** manifest_cid is the sha256 of manifest.json until the manifest itself is pinned (docs/publish.md). */
export const manifestSha256 = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");

/** Sidecar written by `pipeline publish` so the web can show CIDs without touching the DuckDB file. */
export interface RunSidecar {
  run_id: string;
  root_cid: string;
  manifest_cid: string;
  previous_run_id: string | null;
  previous_root_cid: string | null;
}

export interface Publication {
  run_id: string;
  dir: string | null;
  manifest: Manifest | null;
  manifest_raw: string | null;
  /** from run.json when present, else sha256 of manifest.json */
  manifest_cid: string | null;
  /** every verification*.json in the run dir (pipeline host, GitHub Actions, ...), oldest file name first */
  verifications: { file: string; data: Verification }[];
  files: string[];
}

/** Look for publications/<run_id>/manifest.json in each candidate dir (first hit wins). The CAR is optional. */
export function getPublication(dirs: string[], runId: string): Publication {
  if (!/^[\w.:-]+$/.test(runId)) throw new Error("invalid run_id");
  for (const base of dirs) {
    const dir = join(base, runId);
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const raw = readFileSync(manifestPath, "utf8");
    const manifest = ManifestSchema.safeParse(JSON.parse(raw));
    const files = readdirSync(dir).sort();
    const sidecar = files.includes("run.json")
      ? (JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as Partial<RunSidecar>)
      : null;
    const verifications = files
      .filter((f) => /^verification(-[\w.-]+)?\.json$/.test(f))
      .map((f) => ({
        file: f,
        parsed: VerificationSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8"))),
      }))
      .flatMap((v) => (v.parsed.success ? [{ file: v.file, data: v.parsed.data }] : []));
    return {
      run_id: runId,
      dir,
      manifest: manifest.success ? manifest.data : null,
      manifest_raw: raw,
      manifest_cid: sidecar?.manifest_cid ?? manifestSha256(raw),
      verifications,
      files,
    };
  }
  return {
    run_id: runId,
    dir: null,
    manifest: null,
    manifest_raw: null,
    manifest_cid: null,
    verifications: [],
    files: [],
  };
}

/** Every run id that has a manifest.json in any lookup dir, sorted descending (run ids are UTC timestamps). */
export function publishedRunIds(dirs: string[]): string[] {
  const ids = new Set<string>();
  for (const base of dirs) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) if (existsSync(join(base, d, "manifest.json"))) ids.add(d);
  }
  return [...ids].sort().reverse();
}
