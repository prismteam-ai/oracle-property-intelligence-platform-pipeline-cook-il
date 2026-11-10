import { describe, expect, it, vi } from "vitest";
import { canonicalize, fetchJson, pageUrl, whereClause } from "./socrata.js";
import { findSource } from "./sources.js";

const auth = { keyId: "k", keySecret: "s" };
const src = findSource("cook_assessor_permits");

describe("pageUrl/whereClause", () => {
  it("orders by :id, selects system fields and applies filters", () => {
    const u = new URL(
      pageUrl(
        findSource("cook_characteristics"),
        100_000,
        50_000,
        whereClause(findSource("cook_characteristics")),
      ),
    );
    expect(u.searchParams.get("$order")).toBe(":id");
    expect(u.searchParams.get("$offset")).toBe("100000");
    expect(u.searchParams.get("$select")).toMatch(/^:id,:updated_at,pin,/);
    expect(u.searchParams.get("$where")).toBe("(year=2026)");
  });
  it("adds a bounded :updated_at window in incremental mode", () => {
    expect(
      whereClause(src, { since: "2026-01-01T00:00:00.000", until: "2026-02-01T00:00:00.000" }),
    ).toBe(":updated_at > '2026-01-01T00:00:00.000' AND :updated_at <= '2026-02-01T00:00:00.000'");
    expect(whereClause(src)).toBeUndefined();
  });
});

describe("canonicalize", () => {
  it("hashes only source fields deterministically and keys by keyFields", () => {
    const a = canonicalize(src, {
      ":id": "row-1",
      ":updated_at": "2026-01-01T00:00:00.000Z",
      row_id: "r1",
      pin: "1",
      status: "OPEN",
    });
    const b = canonicalize(src, {
      ":id": "row-2",
      ":updated_at": "2026-02-01T00:00:00.000Z",
      status: "OPEN",
      pin: "1",
      row_id: "r1",
    });
    expect(a["_hash"]).toBe(b["_hash"]);
    expect(a["_hash"]).toHaveLength(64);
    expect(a["_key"]).toBe("r1");
    expect(a["_id"]).toBe("row-1");
    expect(canonicalize(src, { ":id": "x", status: "CLOSED" })["_hash"]).not.toBe(a["_hash"]);
  });
  it("falls back to :id when key fields are missing and stringifies non-strings", () => {
    const r = canonicalize(src, { ":id": "sys-9", amount: 12.5 });
    expect(r["_key"]).toBe("sys-9");
    expect(r["amount"]).toBe("12.5");
    expect(r["status"]).toBeNull();
  });
});

describe("fetchJson", () => {
  it("retries 429/5xx with backoff and succeeds", async () => {
    const responses = [
      new Response("slow down", { status: 429, headers: { "retry-after": "1" } }),
      new Response("boom", { status: 503 }),
      new Response(JSON.stringify([{ a: 1 }]), { status: 200 }),
    ];
    const fetchImpl = vi.fn(() => Promise.resolve(responses.shift()!));
    const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
    const out = await fetchJson("http://x", {
      auth,
      fetchImpl: fetchImpl,
      sleep,
    });
    expect(out).toEqual([{ a: 1 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]?.[0]).toBe(1000);
  });
  it("does not retry 4xx other than 429", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("bad", { status: 400 })));
    await expect(
      fetchJson("http://x", {
        auth,
        fetchImpl: fetchImpl,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("sends basic auth", async () => {
    const fetchImpl = vi.fn((_u: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      expect(h["Authorization"]).toBe("Basic " + Buffer.from("k:s").toString("base64"));
      return Promise.resolve(new Response("[]", { status: 200 }));
    });
    await fetchJson("http://x", { auth, fetchImpl: fetchImpl as unknown as typeof fetch });
  });
});
