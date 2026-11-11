import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CarReader } from "@ipld/car";
import { CID } from "multiformats/cid";
import {
  buildDag,
  fileDag,
  fullyVerifiedGateways,
  pinManifest,
  writeCar,
  verify,
  Manifest,
  prunePinata,
} from "./index.js";

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

describe("verify early stop", () => {
  it("skips the rest of a gateway after three consecutive failures", async () => {
    const dir = await fixture();
    const dag = await buildDag(dir);
    const objects = [...dag.objects, ...dag.objects, ...dag.objects, ...dag.objects].filter(
      (o) => o.codec === "file",
    );
    const v = await verify({
      runId: "r1",
      rootCid: dag.rootCid,
      objects,
      gateways: ["http://127.0.0.1:9/ipfs/"],
      verifier: "test",
      timeoutMs: 300,
      retries: 0,
    });
    expect(v.checks.filter((c) => c.error?.startsWith("skipped")).length).toBe(objects.length - 3);
  }, 20_000);
});

describe("durability helpers", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("counts only gateways that returned every object", () => {
    expect(
      fullyVerifiedGateways({
        summary: { a: { ok: 30, total: 30 }, b: { ok: 29, total: 30 }, c: { ok: 0, total: 0 } },
      }),
    ).toEqual(["a"]);
  });
  it("unpins only earlier uploads with the snapshot prefix (Pinata free-tier retention)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (!init?.method)
        return Promise.resolve(
          Response.json({
            data: {
              files: [
                { id: "1", name: "cook-il-20261110T204914Z" },
                { id: "2", name: "proto-dir" },
              ],
            },
          }),
        );
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    expect(await prunePinata("jwt", "cook-il-")).toEqual(["cook-il-20261110T204914Z"]);
    expect(calls).toEqual([
      "GET https://api.pinata.cloud/v3/files/public?limit=100",
      "DELETE https://api.pinata.cloud/v3/files/public/1",
    ]);
  });
});

describe("manifest pinning", () => {
  afterEach(() => vi.unstubAllGlobals());
  const bytes = new TextEncoder().encode('{"schema":"cook-il.artifact-manifest.v1"}\n');
  it("gives a small file a raw-leaf CIDv1 whose digest is the file's sha256", async () => {
    const { rootCid } = await fileDag(bytes);
    const cid = CID.parse(rootCid);
    expect(cid.version).toBe(1);
    expect(cid.code).toBe(0x55); // raw
    expect(Buffer.from(cid.multihash.digest).toString("hex")).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });
  it("records a pin as ok only when the provider returns the local CID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-pin-"));
    const { rootCid } = await fileDag(bytes);
    let returned = rootCid;
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        url.startsWith("https://api.pinata.cloud/v3/files/public")
          ? Response.json({ data: { files: [] } })
          : Response.json({ data: { cid: returned } }),
      ),
    );
    const ok = await pinManifest({
      runId: "r1",
      manifestBytes: bytes,
      carPath: join(dir, "manifest.car"),
      filebase: null,
      pinataJwt: "jwt",
    });
    expect(ok.cid).toBe(rootCid);
    expect(ok.pins.map((p) => [p.provider, p.ok])).toEqual([["pinata", true]]);
    returned = "bafkreiother";
    const bad = await pinManifest({
      runId: "r1",
      manifestBytes: bytes,
      carPath: join(dir, "manifest.car"),
      filebase: null,
      pinataJwt: "jwt",
    });
    expect(bad.pins[0]).toMatchObject({ ok: false, detail: "CID mismatch: bafkreiother" });
  });
});
