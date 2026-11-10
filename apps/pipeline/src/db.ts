import { Duck } from "@cook/duck";
import type { Logger } from "./log.js";

const LOCK_ERROR = /Could not set lock on file/;

export interface OpenRetryOpts {
  open?: () => Promise<Duck>;
  sleep?: (ms: number) => Promise<void>;
  /** default 10 min */
  timeoutMs?: number;
  /** default 5 s */
  backoffMs?: number;
}

/**
 * Open the DuckDB file read-write, waiting out a lock held by another process (the web opens it
 * per query; an earlier pipeline command may still be running). Non-lock errors are rethrown.
 */
export async function openForWrite(
  path: string,
  log: Logger,
  o: OpenRetryOpts = {},
): Promise<Duck> {
  const open = o.open ?? (() => Duck.open(path));
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = o.timeoutMs ?? 600_000;
  const backoffMs = o.backoffMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await open();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!LOCK_ERROR.test(msg)) throw e;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0)
        throw new Error(
          `${path} is still locked by another process after ${Math.round(timeoutMs / 1000)} s; ` +
            `stop the other writer (or wait for it) and retry: ${msg}`,
          { cause: e },
        );
      log.warn(
        { path, retry_in_s: backoffMs / 1000, remaining_s: Math.ceil(remainingMs / 1000) },
        "duckdb file locked by another process; waiting",
      );
      await sleep(backoffMs);
    }
  }
}
