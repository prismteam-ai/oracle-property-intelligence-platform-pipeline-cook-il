import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import type { Run } from "@cook/shared";
import { ALERT_TIMEOUT_MS, runNeedsAttention, signalRun } from "./alert.js";

const log = pino({ level: "silent" });
const base: Run = {
  run_id: "r1",
  started_at: "2026-11-11T00:00:00Z",
  finished_at: "2026-11-11T00:10:00Z",
  status: "ok",
  mode: "incremental",
  sources: [],
  counts: { property: 5 },
  deltas: {},
  dead_letters: [],
  limitations: [],
  manifest_cid: null,
  root_cid: null,
  previous_run_id: null,
};
const dead = {
  source_system: "chicago_permits",
  stage: "fetch" as const,
  key: "page-3",
  error: "HTTP 429",
  at: "2026-11-11T00:05:00Z",
};

describe("signalRun", () => {
  it("exit 0 and no webhook call for a clean run", async () => {
    const fetchImpl = vi.fn();
    expect(await signalRun(base, { webhookUrl: "http://hook", log, fetchImpl })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("exit 1 and a JSON summary POST for dead letters, even with status ok", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
    const run = { ...base, dead_letters: [dead] };
    expect(runNeedsAttention(run)).toBe(true);
    expect(await signalRun(run, { webhookUrl: "http://hook", log, fetchImpl })).toBe(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://hook");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      run_id: "r1",
      status: "ok",
      counts: { property: 5 },
      dead_letters: 1,
      errors: ["chicago_permits/fetch: HTTP 429"],
    });
  });
  it("exit 1 for a failed run; no POST without a webhook; a webhook error never throws", async () => {
    const run = { ...base, status: "failed" as const };
    const fetchImpl = vi.fn();
    expect(await signalRun(run, { log, fetchImpl })).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    const boom = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(await signalRun(run, { webhookUrl: "http://hook", log, fetchImpl: boom })).toBe(1);
  });
  it("bounds webhook requests and never logs credential-bearing transport errors", async () => {
    const lines: string[] = [];
    const captured = pino(
      { level: "error" },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    );
    const webhookUrl = "https://user:private-token@example.test/private-hook";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`fetch failed for ${webhookUrl}`));
    const run = {
      ...base,
      status: "failed" as const,
      dead_letters: [{ ...dead, error: `fetch failed ${webhookUrl}` }],
    };
    expect(await signalRun(run, { webhookUrl, log: captured, fetchImpl })).toBe(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(ALERT_TIMEOUT_MS).toBe(5000);
    expect(lines.join("\n")).not.toContain("private-token");
    expect(lines.join("\n")).not.toContain("private-hook");
    expect(lines.join("\n")).toContain("transport-or-timeout");
  });
});
