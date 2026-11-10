import { serve } from '@hono/node-server';
import { createOpenAI } from '@ai-sdk/openai';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { loadEnv } from './env.js';
import { openDataset } from './db/duck.js';
import { createContext } from './context.js';
import { createApp } from './server.js';
import { logger } from './logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
const dbPath = resolve(env.DATASET_DB);
const fixturePubDir = join(dirname(dbPath), 'publications');

if (!existsSync(dbPath) && !existsSync(env.DATASET_DIR)) {
  logger.warn({ dbPath }, 'no dataset found: generating FIXTURE dataset (synthetic, placeholder CIDs)');
  const { makeFixture } = await import('../../../fixtures/make-fixture.js');
  const summary = await makeFixture(dbPath, fixturePubDir);
  logger.info(summary, 'fixture generated');
}

const ds = await openDataset(dbPath, env.DATASET_DIR);
const model = env.OPENAI_API_KEY ? createOpenAI({ apiKey: env.OPENAI_API_KEY })('gpt-4.1-mini') : null;
const ctx = createContext({ ds, env, pubDirs: [resolve(env.PUBLICATIONS_DIR), fixturePubDir], model });

const commit = (() => {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  const f = join(here, '..', '..', '..', '..', 'build.json');
  if (existsSync(f)) return String(JSON.parse(readFileSync(f, 'utf8')).commit);
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
})();
const app = createApp(ctx, {
  uiDir: resolve(here, '..', '..', '..', '..', 'ui'),
  build: { commit, builtAt: new Date().toISOString() },
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(
    {
      port: info.port,
      dataset: ds.origin,
      agent: model ? model.modelId : 'disabled',
      mcp: env.MCP_HTTP_AUTH_TOKEN ? 'bearer' : 'disabled',
    },
    'web listening',
  );
});
