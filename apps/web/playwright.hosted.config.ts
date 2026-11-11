import { defineConfig } from "@playwright/test";

const run = process.env.HOSTED_RUN ?? new Date().toISOString().replace(/[:.]/g, "-");

export default defineConfig({
  testDir: "./hosted-e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: `test-results/hosted/${run}/results.json` }],
    ["html", { outputFolder: `playwright-report/hosted/${run}`, open: "never" }],
  ],
  outputDir: `test-results/hosted/${run}/artifacts`,
  use: {
    baseURL: process.env.HOSTED_URL ?? "https://cook-il.108-142-177-43.nip.io",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
  },
  projects: ["chromium", "firefox", "webkit"].flatMap((browserName) =>
    [390, 768, 1440].map((width) => ({
      name: `${browserName}-${width}`,
      use: {
        browserName: browserName as "chromium" | "firefox" | "webkit",
        viewport: { width, height: width === 390 ? 844 : 1024 },
        ...(browserName === "webkit" && process.env.WEBKIT_PATH
          ? { launchOptions: { executablePath: process.env.WEBKIT_PATH } }
          : {}),
        ...(browserName === "chromium"
          ? {
              launchOptions: {
                executablePath:
                  process.env.CHROMIUM_PATH ??
                  "/home/vladsterian/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
              },
            }
          : {}),
      },
    })),
  ),
});
