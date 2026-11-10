import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ManifestSchema,
  VerificationSchema,
  type Manifest,
  type Verification,
} from "./contract.js";

export const GATEWAYS = ["https://ipfs.io", "https://dweb.link"] as const;

export function gatewayUrls(cid: string): { gateway: string; url: string }[] {
  return GATEWAYS.map((g) => ({ gateway: g, url: `${g}/ipfs/${cid}` }));
}

export interface Publication {
  run_id: string;
  dir: string | null;
  manifest: Manifest | null;
  manifest_raw: string | null;
  verification: Verification | null;
  files: string[];
}

/** Look for publications/<run_id>/{manifest,verification}.json in each candidate dir (first hit wins). */
export function getPublication(dirs: string[], runId: string): Publication {
  if (!/^[\w.:-]+$/.test(runId)) throw new Error("invalid run_id");
  for (const base of dirs) {
    const dir = join(base, runId);
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const raw = readFileSync(manifestPath, "utf8");
    const manifest = ManifestSchema.safeParse(JSON.parse(raw));
    const verificationPath = join(dir, "verification.json");
    const verification = existsSync(verificationPath)
      ? VerificationSchema.safeParse(JSON.parse(readFileSync(verificationPath, "utf8")))
      : null;
    const carFile =
      manifest.success && manifest.data.car?.name ? manifest.data.car.name : `${runId}.car`;
    return {
      run_id: runId,
      dir,
      manifest: manifest.success ? manifest.data : null,
      manifest_raw: raw,
      verification: verification?.success ? verification.data : null,
      files: [
        "manifest.json",
        ...(verification ? ["verification.json"] : []),
        ...(existsSync(join(dir, carFile)) ? [carFile] : []),
      ],
    };
  }
  return {
    run_id: runId,
    dir: null,
    manifest: null,
    manifest_raw: null,
    verification: null,
    files: [],
  };
}
