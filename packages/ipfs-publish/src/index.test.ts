import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CarReader } from "@ipld/car";
import { buildDag, writeCar, verify, Manifest } from "./index.js";

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dag-"));
  await mkdir(join(dir, "property"), { recursive: true });
  await writeFile(join(dir, "manifest-test.json"), '{"hello":"cook county"}\n');
  // > 256 KiB so chunking matters
  await writeFile(join(dir, "property", "part-0.bin"), randomBytes(600_000));
  return dir;
}

describe("buildDag", () => {
  it("is deterministic and kubo/pinata compatible (CIDv1 base32, raw leaves, 256 KiB chunks)", async () => {
    const dir = await fixture();
    const a = await buildDag(dir);
    const b = await buildDag(dir);
    expect(a.rootCid).toBe(b.rootCid);
    expect(a.rootCid.startsWith("bafybei")).toBe(true);
    const names = a.objects.map((o) => o.name);
    expect(names).toEqual(["manifest-test.json", "property", "property/part-0.bin"]);
    const part = a.objects.find((o) => o.name === "property/part-0.bin")!;
    expect(part.codec).toBe("file");
    expect(part.size).toBe(600_000);
    expect(part.sha256).toHaveLength(64);
    expect(a.objects.find((o) => o.name === "property")!.codec).toBe("directory");
  });
  it("writes a CAR whose root is the directory CID and contains every block", async () => {
    const dir = await fixture();
    const dag = await buildDag(dir);
    const car = join(dir, "out.car");
    const info = await writeCar(dag, car);
    expect(info.size).toBeGreaterThan(600_000);
    const reader = await CarReader.fromBytes(await readFile(car));
    expect((await reader.getRoots())[0]!.toString()).toBe(dag.rootCid);
    let blocks = 0;
    for await (const block of reader.blocks()) if (block) blocks++;
    expect(blocks).toBeGreaterThanOrEqual(5); // 3 raw chunks + file node + 2 dirs
  });
});

describe("verify", () => {
  it("records status, size and digest per gateway without throwing on failures", async () => {
    const dir = await fixture();
    const dag = await buildDag(dir);
    const v = await verify({
      runId: "r1",
      rootCid: dag.rootCid,
      objects: dag.objects,
      gateways: ["http://127.0.0.1:9/ipfs/"],
      verifier: "test",
      timeoutMs: 500,
      retries: 0,
    });
    expect(v.checks).toHaveLength(2);
    expect(v.checks.every((c) => !c.digest_match)).toBe(true);
    expect(v.summary["http://127.0.0.1:9/ipfs/"]).toEqual({ ok: 0, total: 2 });
  }, 20_000);
});

describe("Manifest schema", () => {
  it("rejects a manifest without root_cid", () => {
    expect(() => Manifest.parse({ schema: "cook-il.artifact-manifest.v1", run_id: "x" })).toThrow();
  });
});
