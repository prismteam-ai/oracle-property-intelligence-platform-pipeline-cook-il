import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { trpcServer } from "@hono/trpc-server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppContext } from "./context.js";
import { appRouter } from "./api/router.js";
import { handleMcpRequest } from "./mcp/server.js";
import { logger } from "./logger.js";

export interface BuildInfo {
  commit: string;
  builtAt: string;
}

/** Fixed-window limiter per client IP. ponytail: in-memory, per-process; fine behind one Caddy instance. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (ip: string, now = Date.now()): boolean => {
    const h = hits.get(ip);
    if (!h || h.reset <= now) {
      hits.set(ip, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      return true;
    }
    h.count++;
    return h.count <= max;
  };
}

export function createApp(ctx: AppContext, opts: { uiDir: string; build: BuildInfo }): Hono {
  const app = new Hono();
  const agentLimit = rateLimiter(30, 60_000);

  app.use("*", async (c, next) => {
    const id = c.req.header("x-request-id") ?? randomUUID();
    c.header("x-request-id", id);
    const t0 = Date.now();
    await next();
    if (!c.req.path.startsWith("/assets/"))
      logger.info(
        { id, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t0 },
        "req",
      );
  });

  app.get("/health", async (c) => {
    try {
      const info = await ctx.info();
      return c.json({
        ok: true,
        runId: info.run.run_id,
        rootCid: info.source.rootCid,
        dataset: ctx.ds.origin.kind,
        commit: opts.build.commit,
      });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 503);
    }
  });
  app.get("/build.json", (c) => c.json(opts.build));

  app.use("/trpc/*", async (c, next) => {
    if (c.req.path.includes("agent.ask")) {
      const ip =
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        c.req.header("x-real-ip") ??
        "local";
      if (!agentLimit(ip))
        return c.json({ error: "rate limit: 30 requests per minute per IP" }, 429);
    }
    await next();
  });
  app.use(
    "/trpc/*",
    trpcServer({
      router: appRouter,
      createContext: () => ctx as unknown as Record<string, unknown>,
    }),
  );

  app.use(
    "/mcp",
    cors({
      origin: "*",
      allowHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version"],
      exposeHeaders: ["Mcp-Session-Id"],
    }),
  );
  app.use("/mcp", async (c, next) => {
    // Browser navigation (GET text/html) falls through to the UI docs page; MCP clients use POST or GET+SSE.
    if (c.req.method === "GET" && !(c.req.header("accept") ?? "").includes("text/event-stream"))
      return next();
    const token = ctx.env.MCP_HTTP_AUTH_TOKEN;
    if (!token) return c.json({ error: "MCP disabled: MCP_HTTP_AUTH_TOKEN not configured" }, 503);
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${token}`)
      return c.json(
        { error: "unauthorized: send Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>" },
        401,
      );
    return handleMcpRequest(ctx, c.req.raw);
  });

  // UI: static build + SPA fallback
  const index = join(opts.uiDir, "index.html");
  app.use("/*", serveStatic({ root: opts.uiDir }));
  app.get("/*", (c) =>
    existsSync(index)
      ? c.html(readFileSync(index, "utf8"))
      : c.text("UI not built: run `pnpm --filter @cook-il/web build`", 404),
  );
  return app;
}
