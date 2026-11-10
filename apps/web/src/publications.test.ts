import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatewayUrls, getPublication } from "./publications.js";

describe("publications", () => {
  it("derives gateway URLs from the CID", () => {
    expect(gatewayUrls("bafyabc")).toEqual([
      { gateway: "https://ipfs.io", url: "https://ipfs.io/ipfs/bafyabc" },
      { gateway: "https://dweb.link", url: "https://dweb.link/ipfs/bafyabc" },
    ]);
  });
  it("reads manifest + verification from the first dir that has them", () => {
    const base = mkdtempSync(join(tmpdir(), "pub-"));
    mkdirSync(join(base, "r1"));
    writeFileSync(
      join(base, "r1", "manifest.json"),
      JSON.stringify({
        run_id: "r1",
        root_cid: "bafyroot",
        artifacts: [
          {
            cid: "bafyx",
            name: "tables/property/part-0.parquet",
            size: 10,
            codec: "file",
            sha256: "ab",
          },
        ],
      }),
    );
    writeFileSync(
      join(base, "r1", "verification.json"),
      JSON.stringify({
        results: [
          {
            cid: "bafyx",
            gateway: "https://ipfs.io",
            status: 200,
            size_match: true,
            digest_match: true,
            fetched_at: "2026-11-10T00:00:00Z",
          },
        ],
      }),
    );
    const pub = getPublication(["/nonexistent", base], "r1");
    expect(pub.manifest?.artifacts[0]?.cid).toBe("bafyx");
    expect(pub.verification?.results[0]?.digest_match).toBe(true);
    expect(pub.files).toEqual(["manifest.json", "verification.json"]);
    expect(getPublication([base], "missing").manifest).toBeNull();
    expect(() => getPublication([base], "../etc")).toThrow();
  });
});
