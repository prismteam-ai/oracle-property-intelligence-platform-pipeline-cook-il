import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "fixtures/**/*.test.ts"],
    testTimeout: 30_000,
    server: { deps: { external: [/@duckdb\//, /ngeohash/] } },
  },
});
