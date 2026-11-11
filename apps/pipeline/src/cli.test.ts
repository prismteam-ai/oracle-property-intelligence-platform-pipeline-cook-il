import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { Duck } from "@cook/duck";
import { expect, it } from "vitest";

it("built transform CLI records and signals an offline failure, then exits nonzero with its original error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-cli-failure-"));
  try {
    const child = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, "../dist/cli.js"), "transform", "--data", dir],
      {
        cwd: dir,
        env: {
          SOCRATA_KEY_ID: "offline-fake-key",
          SOCRATA_KEY_SECRET: "offline-fake-secret",
          LOG_LEVEL: "info",
          ALERT_WEBHOOK_URL: "",
        },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    const events = child.stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const alert = events.find((event) => event.msg === "run needs attention");
    expect(alert).toMatchObject({
      event: "run-needs-attention",
      status: "failed",
      dead_letters: 1,
    });
    const db = await Duck.open(join(dir, "cook_il.duckdb"), { access_mode: "READ_ONLY" });
    try {
      const rows = await db.query<{ run_id: string; status: string; dead_letters: string }>(
        "select run_id, status, dead_letters from run",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("failed");
      expect(alert?.run_id).toBe(rows[0]?.run_id);
      const dead = JSON.parse(rows[0]!.dead_letters) as { error: string }[];
      expect(dead).toHaveLength(1);
      expect(events.find((event) => event.msg === "fatal")?.error).toBe(dead[0]?.error);
      expect(dead[0]?.error).toMatch(/does not exist|not found/i);
    } finally {
      db.close();
    }
    const history = JSON.parse(readFileSync(join(dir, "run-history.json"), "utf8")) as {
      status: string;
    }[];
    expect(history[0]?.status).toBe("failed");
    expect(child.stdout + child.stderr).not.toContain("offline-fake-secret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
