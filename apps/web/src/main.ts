import { serve } from "@hono/node-server";
import { bootstrap } from "./bootstrap.js";
import { logger } from "./logger.js";

const { app, ds, env, model } = await bootstrap();

// Pick up publications and run history written by the pipeline/publisher containers without a restart.
let refreshing = false;
setInterval(() => {
  if (refreshing || !ds.refresh) return;
  refreshing = true;
  ds.refresh()
    .catch((e: unknown) =>
      logger.error({ error: e instanceof Error ? e.message : String(e) }, "dataset refresh failed"),
    )
    .finally(() => (refreshing = false));
}, 60_000).unref();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(
    {
      port: info.port,
      dataset: ds.origin,
      agent: model,
      mcp: env.MCP_HTTP_AUTH_TOKEN ? "bearer" : "disabled",
    },
    "web listening",
  );
});
