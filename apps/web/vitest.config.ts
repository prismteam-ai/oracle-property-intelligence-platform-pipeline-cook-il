import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "fixtures/**/*.test.ts"],
    testTimeout: 30_000,
    server: { deps: { external: [/@duckdb\//, /ngeohash/] } },
  },
});
