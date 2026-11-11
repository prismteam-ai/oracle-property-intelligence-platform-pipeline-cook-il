#!/usr/bin/env node
import process from "node:process";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const originalEnv = { ...process.env };
let env = originalEnv;
if (originalEnv.MCP_ENV_FILE) {
  // Credentials remain inside this process. Forward only the named read-only bearer,
  // never the rest of the .env file, and never put it in argv or report output.
  process.loadEnvFile(originalEnv.MCP_ENV_FILE);
  const token = process.env.MCP_HTTP_AUTH_TOKEN;
  if (!token)
    throw new Error("MCP_HTTP_AUTH_TOKEN is missing from the configured environment file");
  env = { ...originalEnv, MCP_HTTP_AUTH_TOKEN: token };
}
if (!originalEnv.EXPECTED_SHA)
  throw new Error("Set EXPECTED_SHA to the reviewed deployed revision");
const result = spawnSync(
  process.execPath,
  [
    resolve(root, "apps/web/node_modules/@playwright/test/cli.js"),
    "test",
    "-c",
    resolve(root, "apps/web/playwright.hosted.config.ts"),
    ...process.argv.slice(2),
  ],
  { cwd: root, env, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
