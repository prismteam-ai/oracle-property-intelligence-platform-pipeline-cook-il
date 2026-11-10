import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

test("run summary shows run id, sources, counts, deltas, limitations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("run-id")).toHaveText(/^2026-11-10T02-00-00Z$/);
  await expect(page.getByTestId("fixture-banner")).toBeVisible();
  await expect(page.getByTestId("card-property")).toContainText("5,000");
  await expect(page.getByTestId("card-permit")).toContainText("2,000");
  await expect(page.getByTestId("card-permit")).toContainText("600 roofing");
  await expect(page.getByTestId("card-contractor")).toContainText("300");
  await expect(page.getByTestId("sources")).toContainText(
    "https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json",
  );
  await expect(page.getByTestId("sources")).toContainText(
    "data.cityofchicago.org/resource/ydr8-5enu.json",
  );
  await expect(page.getByTestId("provenance")).toContainText("bafybeifixturerootthree");
  await expect(page.getByTestId("coverage")).toContainText("Cook County, IL");
  await expect(page.getByTestId("deltas")).toContainText("property");
  await expect(page.getByTestId("dead-letters")).toContainText("HTTP 429");
  await expect(page.getByTestId("limitations")).toContainText("FIXTURE DATA");
  await expect(page.getByTestId("card-started")).toContainText(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/,
  );
  await expect(page.getByTestId("card-finished")).toContainText(/T\d{2}:\d{2}:\d{2}Z/);
});

test("run history lists all runs with CIDs and links to publications", async ({ page }) => {
  await page.goto("/runs");
  const rows = page.getByTestId("runs").locator("tbody tr");
  await expect(rows).toHaveCount(3);
  for (const cell of await rows.first().locator("td").nth(3).allTextContents())
    expect(cell).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  await expect(page.getByTestId("runs")).toContainText("bafybeifixturerootone");
  await expect(page.getByTestId("runs")).toContainText("bafybeifixturemanifestthree");
  await page.getByRole("link", { name: "2026-11-08T02-00-00Z" }).click();
  await expect(page).toHaveURL(/\/publications\/2026-11-08T02-00-00Z$/);
  await expect(page.getByTestId("root-cid")).toHaveText(/bafybeifixtureroottwo/);
});

test("publications renders manifest, gateway URLs, verification and previous CID chain", async ({
  page,
}) => {
  await page.goto("/publications");
  await expect(page.getByTestId("root-cid")).toHaveText(/bafybeifixturerootthree/);
  await expect(page.getByTestId("gateway-urls")).toContainText(
    "https://ipfs.io/ipfs/bafybeifixturerootthree",
  );
  await expect(page.getByTestId("gateway-urls")).toContainText(
    "https://dweb.link/ipfs/bafybeifixturerootthree",
  );
  await expect(page.getByTestId("gateway-urls").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("pins").locator("tbody tr")).toHaveCount(2);
  await expect(page.getByTestId("artifacts").locator("tbody tr")).toHaveCount(15);
  await expect(page.getByTestId("artifacts")).toContainText("property/part-0000.parquet");
  await expect(page.getByTestId("artifacts")).toContainText("directory");
  await expect(page.getByTestId("verification-summary-fixture").locator("tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("verification-checks-fixture").locator("tbody tr")).toHaveCount(42);
  await expect(page.getByTestId("pub-summary")).toContainText("bafybeifixtureroottwo");
  await expect(page.getByTestId("pub-summary")).toContainText(".car");
  await expect(page.getByTestId("manifest-json")).toContainText('"objects"');
});

test("sql console runs a sample query and blocks writes", async ({ page }) => {
  await page.goto("/query");
  await page.getByTestId("sample-query").filter({ hasText: "Open roofing permits" }).click();
  await page.getByTestId("run-sql").click();
  await expect(page.getByTestId("sql-meta")).toContainText("100 rows");
  await expect(page.getByTestId("sql-result")).toContainText("bbb_rating");
  await page.getByTestId("sql").fill("DELETE FROM property");
  await page.getByTestId("run-sql").click();
  await expect(page.getByTestId("sql-error")).toContainText("only SELECT/WITH");
});

test("explore performs a radius search and shows provenance", async ({ page }) => {
  await page.goto("/explore");
  await page.getByTestId("lat").fill("42.0451");
  await page.getByTestId("lon").fill("-87.6877");
  await page.getByTestId("radius").fill("2");
  await page.getByTestId("min-roof-age").fill("15");
  await page.getByTestId("open-only").check();
  await page.getByTestId("min-open-years").fill("3");
  await page.getByTestId("search").click();
  await expect(page.getByTestId("search-meta")).toContainText(
    /Showing \d+ of \d+ properties within 2 mi/,
  );
  const results = page.getByTestId("result");
  expect(await results.count()).toBeGreaterThan(0);
  const first = results.first();
  await expect(first).toContainText("roof age");
  await expect(first).toContainText("basis");
  await expect(first).toContainText("ROOFING permit");
  await expect(first).toContainText("open_days");
  await expect(first).toContainText(
    /BBB(: (not available|unknown) \(| [A-F][+-]? ?(\(archived copy, )?)/,
  );
  await expect(first).toContainText("provenance: fixture");
  await expect(first.locator('a[href^="https://"]').first()).toBeVisible();
});

test("agent page shows example prompts and a disabled-agent answer without a key", async ({
  page,
}) => {
  await page.goto("/agent");
  await expect(page.getByTestId("agent-example")).toHaveCount(2);
  await page.getByTestId("agent-example").first().click();
  await expect(page.getByTestId("msg-user")).toContainText("five miles");
  await expect(page.getByTestId("msg-agent")).toContainText(/OPENAI_API_KEY|pin14/i, {
    timeout: 60_000,
  });
});

test("mcp docs page lists tools and the bearer token note", async ({ page }) => {
  await page.goto("/mcp");
  await expect(page.getByTestId("mcp-tools").locator("tbody tr")).toHaveCount(5);
  await expect(page.getByTestId("mcp-tools")).toContainText("findProperties");
  await expect(page.getByTestId("mcp-auth-note")).toContainText("Bearer");
  await expect(page.getByTestId("mcp-endpoint")).toContainText("/mcp");
});

test("mcp endpoint answers tools/list with the bearer token", async ({ request }) => {
  const res = await request.post("/mcp", {
    headers: { authorization: "Bearer e2e-token", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { result: { tools: { name: string }[] } };
  expect(body.result.tools.map((t) => t.name)).toContain("getDatasetInfo");
  expect((await request.post("/mcp", { data: {} })).status()).toBe(401);
});

/** After loading and after the page's main interaction, the document must not scroll sideways. */
const INTERACT: Record<string, (page: Page) => Promise<void>> = {
  "/": async (page) => {
    await expect(page.getByTestId("sources")).toBeVisible();
  },
  "/runs": async (page) => {
    await expect(page.getByTestId("runs")).toBeVisible();
  },
  "/publications": async (page) => {
    await expect(page.getByTestId("manifest-json")).toBeVisible();
    await page.locator("details summary").first().click();
  },
  "/query": async (page) => {
    await page.getByTestId("sample-query").filter({ hasText: "Open roofing permits" }).click();
    await page.getByTestId("run-sql").click();
    await expect(page.getByTestId("sql-result")).toBeVisible();
  },
  "/explore": async (page) => {
    await page.getByTestId("open-only").check();
    await page.getByTestId("search").click();
    await expect(page.getByTestId("search-meta")).toContainText("Showing");
  },
  "/agent": async (page) => {
    await page.getByTestId("agent-example").first().click();
    await expect(page.getByTestId("msg-agent")).toBeVisible({ timeout: 60_000 });
  },
  "/mcp": async (page) => {
    await expect(page.getByTestId("mcp-tools")).toBeVisible();
  },
};

for (const vp of VIEWPORTS) {
  test(`responsive ${vp.name}: no horizontal overflow on every page, before and after interaction`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const noOverflow = async (label: string) => {
      const [scrollWidth, innerWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        window.innerWidth,
      ]);
      expect(scrollWidth, label).toBeLessThanOrEqual(innerWidth);
    };
    for (const [path, interact] of Object.entries(INTERACT)) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await noOverflow(`${path} at ${vp.name} after load`);
      await interact(page);
      await noOverflow(`${path} at ${vp.name} after interaction`);
    }
  });
}
