import { describe, expect, it, vi } from "vitest";
import type pino from "pino";
import type { Duck } from "@cook/duck";
import { openForWrite } from "./db.js";

const LOCK = new Error(
  'IO Error: Could not set lock on file "/app/data/cook_il.duckdb": Conflicting lock is held in PID 0',
);
const db = { close() {} } as unknown as Duck;

describe("openForWrite", () => {
  it("retries on the lock error with backoff, logging the remaining time", async () => {
    const open = vi
      .fn<() => Promise<Duck>>()
      .mockRejectedValueOnce(LOCK)
      .mockRejectedValueOnce(LOCK)
      .mockResolvedValue(db);
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
    const warn = vi.fn();
    const log = { warn } as unknown as pino.Logger;
    await expect(openForWrite("x.duckdb", log, { open, sleep, backoffMs: 5_000 })).resolves.toBe(
      db,
    );
    expect(open).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[5_000], [5_000]]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ retry_in_s: 5, remaining_s: 600 });
  });
  it("fails with a clear message once the deadline passes", async () => {
    const open = vi.fn<() => Promise<Duck>>().mockRejectedValue(LOCK);
    const log = { warn: vi.fn() } as unknown as pino.Logger;
    await expect(
      openForWrite("x.duckdb", log, { open, sleep: async () => {}, timeoutMs: 0 }),
    ).rejects.toThrow(/still locked by another process after 0 s/);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("rethrows other errors immediately", async () => {
    const open = vi.fn<() => Promise<Duck>>().mockRejectedValue(new Error("boom"));
    const log = { warn: vi.fn() } as unknown as pino.Logger;
    await expect(openForWrite("x.duckdb", log, { open, sleep: async () => {} })).rejects.toThrow(
      "boom",
    );
  });
});
