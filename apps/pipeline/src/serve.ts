import { createServer } from "node:http";
import type { Duck } from "@cook/duck";
import { log } from "./log.js";

/** Placeholder HTTP surface until apps/web lands: /health and /build.json per hosting convention. */
export function serve(db: Duck, port: number, build: { commit: string; builtAt: string }): void {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.url === "/health") {
        const last = await db
          .one<{ run_id: string; status: string; finished_at: string | null }>(
            "select run_id, status, finished_at from run order by started_at desc limit 1",
          )
          .catch(() => undefined);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, service: "pipeline", lastRun: last ?? null }));
        return;
      }
      if (req.url === "/build.json") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(build));
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    })().catch((e: unknown) => {
      res.statusCode = 500;
      res.end(e instanceof Error ? e.message : "error");
    });
  });
  server.listen(port, () => log.info({ port }, "serving"));
}
