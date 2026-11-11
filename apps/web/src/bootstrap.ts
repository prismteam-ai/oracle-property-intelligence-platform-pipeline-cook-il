import { createOpenAI } from "@ai-sdk/openai";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import type { Hono } from "hono";
import { loadEnv, type Env } from "./env.js";
import { publishedRunIds } from "./publications.js";
import { openDataset, type Dataset } from "./db/duck.js";
import { createContext } from "./context.js";
import { createApp } from "./server.js";
import { logger } from "./logger.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Env, dataset (or generated fixture), model and the Hono app; shared by main.ts (node server) and lambda.ts. */
export async function bootstrap(): Promise<{ app: Hono; ds: Dataset; env: Env; model: string }> {
  const env = loadEnv();
  const dbPath = resolve(env.DATASET_DB);
  const fixturePubDir = join(dirname(dbPath), "publications");

  if (
    !existsSync(dbPath) &&
    !existsSync(env.DATASET_DIR) &&
    env.REQUIRE_PUBLISHED_SNAPSHOT !== "true"
  ) {
    logger.warn(
      { dbPath },
      "no dataset found: generating FIXTURE dataset (synthetic, placeholder CIDs)",
    );
    const { makeFixture } = await import("../../../fixtures/make-fixture.js");
    const summary = await makeFixture(dbPath, fixturePubDir);
    logger.info(summary, "fixture generated");
  }

  const pubDirs = [resolve(env.PUBLICATIONS_DIR), resolve("publications"), fixturePubDir];
  const hasPublishedData = publishedRunIds(pubDirs).some((id) =>
    existsSync(join(env.DATASET_DIR, id, "property")),
  );
  const ds = await openDataset(
    dbPath,
    env.DATASET_DIR,
    hasPublishedData || env.REQUIRE_PUBLISHED_SNAPSHOT === "true"
      ? {
          pubDirs,
          historyPath: join(env.DATA_DIR, "run-history.json"),
        }
      : undefined,
  );
  const model = env.OPENAI_API_KEY
    ? createOpenAI({ apiKey: env.OPENAI_API_KEY })("gpt-4.1-mini")
    : null;
  const ctx = createContext({
    ds,
    env,
    pubDirs,
    model,
  });

  const commit = (() => {
    if (env.GIT_COMMIT) return env.GIT_COMMIT;
    const f = join(here, "..", "..", "..", "..", "build.json");
    if (existsSync(f))
      return String((JSON.parse(readFileSync(f, "utf8")) as { commit?: unknown }).commit);
    try {
      return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return "unknown";
    }
  })();
  const app = createApp(ctx, {
    uiDir: resolve(here, "..", "..", "..", "..", "ui"),
    build: { commit, builtAt: new Date().toISOString() },
  });
  return { app, ds, env, model: model ? model.modelId : "disabled" };
}
