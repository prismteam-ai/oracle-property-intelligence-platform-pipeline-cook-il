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

/** URL of a CID (optionally a path below it) on every default gateway. */
export function gatewayUrls(cid: string, path?: string): { gateway: string; url: string }[] {
  return GATEWAYS.map((g) => ({
    gateway: new URL(g).origin,
    url: `${g}${cid}${path ? `/${path}` : ""}`,
  }));
}

export interface Publication {
  run_id: string;
  dir: string | null;
  manifest: Manifest | null;
  manifest_raw: string | null;
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
      verifications,
      files,
    };
  }
  return {
    run_id: runId,
    dir: null,
    manifest: null,
    manifest_raw: null,
    verifications: [],
    files: [],
  };
}
