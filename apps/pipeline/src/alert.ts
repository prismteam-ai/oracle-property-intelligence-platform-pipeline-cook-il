import type { Run } from "@cook/shared";
import type { Logger } from "./log.js";

export interface RunAlert {
  run_id: string;
  status: Run["status"];
  counts: Run["counts"];
  dead_letters: number;
  errors: string[];
}

/** A run is a failure signal when it ended `failed` or produced dead letters, even with status ok. */
export function runNeedsAttention(run: Pick<Run, "status" | "dead_letters">): boolean {
  return run.status === "failed" || run.dead_letters.length > 0;
}

export function runAlert(run: Run): RunAlert {
  return {
    run_id: run.run_id,
    status: run.status,
    counts: run.counts,
    dead_letters: run.dead_letters.length,
    errors: run.dead_letters.map((d) => `${d.source_system}/${d.stage}: ${d.error}`),
  };
}

/**
 * Failure signalling for the run CLI: returns the process exit code (1 when the run needs attention) and, when
 * `webhookUrl` (ALERT_WEBHOOK_URL) is set, POSTs the JSON summary there. A webhook failure is logged, never thrown:
 * the exit code already carries the signal.
 */
export async function signalRun(
  run: Run,
  opts: { webhookUrl?: string | undefined; log: Logger; fetchImpl?: typeof fetch },
): Promise<number> {
  if (!runNeedsAttention(run)) return 0;
  const alert = runAlert(run);
  opts.log.error(alert, "run needs attention");
  if (opts.webhookUrl) {
    try {
      const res = await (opts.fetchImpl ?? fetch)(opts.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(alert),
      });
      if (!res.ok) opts.log.error({ status: res.status }, "alert webhook rejected the summary");
    } catch (e) {
      opts.log.error({ error: e instanceof Error ? e.message : String(e) }, "alert webhook failed");
    }
  }
  return 1;
}
