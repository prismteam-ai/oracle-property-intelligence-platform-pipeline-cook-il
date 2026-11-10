import { defineConfig } from '@playwright/test';

const port = 8089;
const dir = process.env.E2E_DIR ?? '/tmp/cook-il-e2e';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `pnpm build && pnpm fixture ${dir}/cook_il.duckdb ${dir}/publications && PORT=${port} DATASET_DB=${dir}/cook_il.duckdb MCP_HTTP_AUTH_TOKEN=e2e-token node dist/server/apps/web/src/main.js`,
    url: `http://localhost:${port}/health`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
