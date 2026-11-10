import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATEWAYS, gatewayUrls, getPublication } from "./publications.js";

const manifest = {
  schema: "cook-il.artifact-manifest.v1",
  run_id: "r1",
  created_at: "2026-11-10T00:00:00Z",
  root_cid: "bafyroot",
  car: { name: "r1.car", size: 10, sha256: "a".repeat(64), cid: null },
  previous_run_id: null,
  previous_root_cid: null,
  ipns: null,
  objects: [
    { name: ".", cid: "bafyroot", size: 0, codec: "directory", sha256: null },
    {
      name: "property/part-0.parquet",
      cid: "bafyx",
      size: 10,
      codec: "file",
      sha256: "b".repeat(64),
    },
  ],
  pins: [{ provider: "pinata", cid: "bafyroot", at: "2026-11-10T00:00:00Z", ok: true }],
  origins: [],
};
const verification = (verifier: string) => ({
  run_id: "r1",
  root_cid: "bafyroot",
  verified_at: "2026-11-10T00:00:00Z",
  verifier,
  gateways: ["https://ipfs.io/ipfs/"],
  checks: [
    {
      gateway: "https://ipfs.io/ipfs/",
      name: "property/part-0.parquet",
      cid: "bafyx",
      status: 200,
      size_match: true,
      digest_match: true,
      ms: 5,
      fetched_at: "2026-11-10T00:00:00Z",
    },
  ],
  summary: { "https://ipfs.io/ipfs/": { ok: 1, total: 1 } },
});

describe("publications", () => {
  it("derives URLs on all six default gateways", () => {
    const urls = gatewayUrls("bafyabc", "property/part-0.parquet");
    expect(GATEWAYS).toHaveLength(6);
    expect(urls).toHaveLength(6);
    expect(urls[0]).toEqual({
      gateway: "https://ipfs.io",
      url: "https://ipfs.io/ipfs/bafyabc/property/part-0.parquet",
    });
    expect(gatewayUrls("bafyabc").map((u) => u.gateway)).toContain("https://ipfs.filebase.io");
  });
  it("reads manifest + every verification*.json from the first dir that has them; CAR optional", () => {
    const base = mkdtempSync(join(tmpdir(), "pub-"));
    mkdirSync(join(base, "r1"));
    writeFileSync(join(base, "r1", "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(base, "r1", "verification.json"), JSON.stringify(verification("host")));
    writeFileSync(
      join(base, "r1", "verification-github-actions.json"),
      JSON.stringify(verification("github-actions")),
    );
    const pub = getPublication(["/nonexistent", base], "r1");
    expect(pub.manifest?.objects[1]?.cid).toBe("bafyx");
    expect(pub.manifest?.pins[0]?.provider).toBe("pinata");
    expect(pub.verifications.map((v) => [v.file, v.data.verifier])).toEqual([
      ["verification-github-actions.json", "github-actions"],
      ["verification.json", "host"],
    ]);
    expect(pub.files).not.toContain("r1.car");
    expect(getPublication([base], "missing").manifest).toBeNull();
    expect(() => getPublication([base], "../etc")).toThrow();
  });
});
