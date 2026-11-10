import { serve } from "@hono/node-server";
import { bootstrap } from "./bootstrap.js";
import { logger } from "./logger.js";

const { app, ds, env, model } = await bootstrap();

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
