import { defineConfig } from "vitest/config";

// esbuild bundling of the Lambda entry runs inside the synth assertion
export default defineConfig({ test: { testTimeout: 60_000 } });
