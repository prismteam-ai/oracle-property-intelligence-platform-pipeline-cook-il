import { createHash } from "node:crypto";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../src/api/router.js";
import { rpcData } from "./support.js";
type Output = inferRouterOutputs<AppRouter>;
type Properties = Output["search"]["properties"];
type Publication = Output["publications"]["get"];

import { test, expect, inventory, noOverflow, query, RUN, ROOT } from "./support.js";

const SQL = "SELECT count(*)::INTEGER AS properties FROM property";
const PROMPTS = [
  "Which properties in Cook County within five miles of Evanston have roofs older than 15 years?",
  "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?",
] as const;

test("S01-S06 P01-P02: all routes, nav, back/forward, responsive inventory", async ({
  page,
}, info) => {
  const routes: [string, string][] = [
    ["/", "run summary"],
    ["/runs", "run history"],
    ["/publications", "publications"],
    ["/query", "SQL"],
    ["/explore", "Explore"],
    ["/agent", "Agent"],
    ["/mcp", "MCP"],
  ];
  await page.goto("/");
  await expect(page.getByTestId("run-id")).toHaveText(RUN);
  await expect(page.getByTestId("card-property")).toContainText("1,864,469");
  await expect(page.getByTestId("fixture-banner")).toHaveCount(0);
  await expect(page.getByTestId("sources").locator("tbody tr")).toHaveCount(8);
  for (const [route, heading] of routes) {
    await page.locator(`nav a[href="${route}"]`).click();
    await expect(page.locator("h1")).toContainText(new RegExp(heading, "i"));
    await inventory(page, info, route);
    await noOverflow(page);
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/agent$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/mcp$/);
  await page.reload();
  await expect(page.getByTestId("mcp-tools").locator("tbody tr")).toHaveCount(5);
  await page.goto("/runs");
  await expect
    .poll(() => page.getByTestId("runs").locator("tbody tr").count())
    .toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("runs")).toContainText(RUN);
});

test("P03-P04: publication navigation, manifest and expanded verification evidence", async ({
  page,
}, info) => {
  await page.goto("/publications");
  await expect(page.getByTestId("root-cid")).toHaveText(ROOT);
  await expect(page.getByTestId("manifest-json")).toContainText(RUN);
  await expect(page.getByTestId("artifacts")).toContainText("source_watermark/data_0.parquet");
  await expect(page.getByTestId("pins")).toContainText("filebase");
  await expect(page.getByTestId("verification-summary-wsl-publisher")).toContainText("30");
  for (const detail of await page.locator("details").all()) {
    await detail.locator("summary").click();
    await expect(detail).toHaveAttribute("open", "");
    await detail.locator("summary").click();
    await expect(detail).not.toHaveAttribute("open", "");
  }
  await page.getByTestId("pub-link-20261110T205226Z").click();
  await expect(page.getByTestId("root-cid")).toHaveText(
    "bafybeifdjkwcg53jfozwgkwbd24koa26m72hjhkikca2ga2i6jac34isce",
  );
  await inventory(page, info, "/publications/20261110T205226Z");
  await noOverflow(page);
});

test("P12 P09: every SQL sample executes, row limit and ownership filters", async ({ page }) => {
  await page.goto("/query");
  const samples = page.getByTestId("sample-query");
  expect(await samples.count()).toBe(7);
  for (let i = 0; i < (await samples.count()); i++) {
    await samples.nth(i).click();
    const sql = await page.getByTestId("sql").inputValue();
    const response = await query(page, sql, 5);
    expect(response.ok()).toBeTruthy();
    await expect(page.getByTestId("sql-meta")).toContainText("rows");
    expect(await page.getByTestId("sql-result").locator("tbody tr").count()).toBeLessThanOrEqual(5);
  }
  await query(page, SQL);
  await expect(page.getByTestId("sql-result")).toContainText("1,864,469");
});

test("S04 S07 P12 negative: invalid/write/multi SQL, external reads and recovery", async ({
  page,
}) => {
  await page.goto("/query");
  for (const sql of [
    "DELETE FROM property",
    "SELECT 1; SELECT 2",
    "SELECT * FROM read_text('/etc/passwd')",
    "SELECT missing_column FROM property",
    "",
  ]) {
    await query(page, sql);
    await expect(page.getByTestId("sql-error")).toBeVisible();
  }
  await query(page, "SELECT 42 AS answer", 1);
  await expect(page.getByTestId("sql-result")).toContainText("42");
  await page.getByTestId("limit").fill("1001");
  await page.getByTestId("run-sql").click();
  await expect(page.getByTestId("sql-error")).toBeVisible();
  await query(page, "SELECT 42 AS answer", 1);
  await expect(page.getByTestId("sql-error")).toBeHidden();
});

test("P05-P08: exact radius roof filter, all sort options, open permits and map controls", async ({
  page,
}, info) => {
  await page.goto("/explore");
  await page.getByTestId("lat").fill("42.0451");
  await page.getByTestId("lon").fill("-87.6877");
  await page.getByTestId("radius").fill("2");
  await page.getByTestId("min-roof-age").fill("150");
  const response = page.waitForResponse((r) => r.url().includes("search.properties"));
  await page.getByTestId("search").click();
  const data = rpcData<Properties>(await (await response).json());
  expect(data.properties.length).toBeGreaterThan(0);
  expect(
    data.properties.every(
      (p) =>
        p.roof_age_years !== null &&
        p.roof_age_years >= 150 &&
        p.distance_miles !== null &&
        p.distance_miles <= 2,
    ),
  ).toBeTruthy();
  expect(data.source.rootCid).toBe(ROOT);
  await expect(page.getByTestId("search-meta")).toContainText("56");
  for (const value of ["distance", "roof_age", "open_days"]) {
    await page.getByTestId("sort").selectOption(value);
    await expect(page.getByTestId("sort")).toHaveValue(value);
  }
  await page.getByTestId("min-roof-age").fill("15");
  await page.getByTestId("radius").fill("5");
  await page.getByTestId("open-only").check();
  await page.getByTestId("min-open-years").fill("3");
  const openResponse = page.waitForResponse((r) => r.url().includes("search.properties"));
  await page.getByTestId("search").click();
  const open = rpcData<Properties>(await (await openResponse).json());
  expect(open.properties.length).toBeGreaterThan(0);
  expect(
    open.properties.every((p) =>
      p.permits.some(
        (x) => x.is_roofing && x.status_is_open && x.open_days !== null && x.open_days >= 1095,
      ),
    ),
  ).toBeTruthy();
  await expect(page.getByTestId("results")).toContainText("BBB");
  for (const title of ["Zoom in", "Zoom out"])
    await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByTestId("map").click({ position: { x: 90, y: 90 } });
  await expect(page.getByTestId("lat")).not.toHaveValue("42.0451");
  await inventory(page, info, "/explore/results");
  await noOverflow(page);
});

test("P05 S04 negative: invalid radius and empty result recover visibly", async ({ page }) => {
  await page.goto("/explore");
  await page.getByTestId("radius").fill("-1");
  await page.getByTestId("search").click();
  await expect(page.getByTestId("search-error")).toBeVisible();
  await page.getByTestId("radius").fill("0.1");
  await page.getByTestId("lat").fill("0");
  await page.getByTestId("lon").fill("0");
  await page.getByTestId("search").click();
  await expect(page.getByTestId("search-meta")).toContainText("Showing 0 of 0");
  await expect(page.getByTestId("search-error")).toBeHidden();
});

test("P10: both exact README prompts, keyboard submit, persisted follow-up and clear", async ({
  page,
}) => {
  await page.goto("/agent");
  await page.getByTestId("agent-send").click();
  await expect(page.getByTestId("msg-user")).toHaveCount(0);
  await page.getByTestId("agent-example").nth(0).click();
  await expect(page.getByTestId("msg-agent")).toHaveCount(1, { timeout: 100_000 });
  await expect(page.getByTestId("msg-agent").first()).toContainText(/Evanston|PIN|pin14/i);
  await expect(page.getByTestId("msg-agent").first()).toContainText(ROOT);
  await page.getByTestId("agent-input").fill(PROMPTS[1]);
  await page.getByTestId("agent-input").press("Enter");
  await expect(page.getByTestId("msg-agent")).toHaveCount(2, { timeout: 100_000 });
  await expect(page.getByTestId("msg-agent").last()).toContainText(/contractor|permit/i);
  await page.reload();
  await expect(page.getByTestId("msg-agent")).toHaveCount(2);
  await page.getByTestId("agent-clear").click();
  await expect(page.getByTestId("msg-agent")).toHaveCount(0);
});

test("PV05 exact required gateway pair: both resolve with size and digest", async ({
  request,
}, info) => {
  const response = await request.get(
    "/trpc/publications.get?input=" + encodeURIComponent(JSON.stringify({ run_id: RUN })),
  );
  const data = rpcData<Publication>(await response.json());
  if (!data.publication.manifest) throw new Error("missing manifest");
  const object = data.publication.manifest.objects.find(
    (o: { name: string }) => o.name === "source_watermark/data_0.parquet",
  );
  if (!object) throw new Error("missing frozen artifact");
  const results = [];
  for (const gateway of ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"]) {
    const r = await request.get(gateway + ROOT + "/" + object.name, { timeout: 30_000 });
    const bytes = await r.body();
    results.push({
      gateway,
      status: r.status(),
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await info.attach("exact-gateway-pair", {
    body: JSON.stringify({ expected: object, actual: results }),
    contentType: "application/json",
  });
  for (const r of results) {
    expect.soft(r.status).toBe(200);
    expect.soft(r.size).toBe(object.size);
    expect.soft(r.sha256).toBe(object.sha256);
  }
});

test("PV01-PV11 canonical ordered video journey, exact queries/prompts and gateway evidence", async ({
  page,
  request,
}, info) => {
  test.setTimeout(360_000);
  await test.step("PV01 run summary", async () => {
    await page.goto("/");
    await expect(page.getByTestId("run-id")).toHaveText(RUN);
    await expect(page.getByTestId("card-property")).toContainText("1,864,469");
  });
  await test.step("PV02 all8 source records", async () => {
    await expect(page.getByTestId("sources").locator("tbody tr")).toHaveCount(8);
    await info.attach("canonical-sources", {
      body: await page.getByTestId("sources").innerText(),
      contentType: "text/plain",
    });
  });
  await test.step("PV03 exact SQL count and read-only negative control", async () => {
    await page.goto("/query");
    await query(page, SQL);
    await expect(page.getByTestId("sql-result")).toContainText("1,864,469");
    await query(page, "DELETE FROM property");
    await expect(page.getByTestId("sql-error")).toBeVisible();
    await query(page, SQL);
    await expect(page.getByTestId("sql-error")).toBeHidden();
  });
  await test.step("PV04 manifest", async () => {
    await page.goto(`/publications/${RUN}`);
    await expect(page.getByTestId("root-cid")).toHaveText(ROOT);
    await expect(page.getByTestId("manifest-json")).toContainText(RUN);
  });
  await test.step("PV05 exact ipfs.io+dweb.link byte/hash verification", async () => {
    const response = await request.get(
      "/trpc/publications.get?input=" + encodeURIComponent(JSON.stringify({ run_id: RUN })),
    );
    const pub = rpcData<Publication>(await response.json());
    if (!pub.publication.manifest) throw new Error("missing manifest");
    const object = pub.publication.manifest.objects.find(
      (o: { name: string }) => o.name === "source_watermark/data_0.parquet",
    );
    if (!object) throw new Error("missing frozen artifact");
    if (!object) throw new Error("missing frozen artifact");
    const results = [];
    for (const gateway of ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"]) {
      const r = await request.get(gateway + ROOT + "/" + object.name, { timeout: 30_000 });
      const body = await r.body();
      const actual = {
        gateway,
        status: r.status(),
        size: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
      };
      results.push(actual);
      expect.soft(actual.status, gateway).toBe(200);
      expect.soft(actual.size, gateway).toBe(object.size);
      expect.soft(actual.sha256, gateway).toBe(object.sha256);
    }
    await info.attach("PV05-exact-gateways", {
      body: JSON.stringify({ expected: object, actual: results }),
      contentType: "application/json",
    });
  });
  await test.step("PV06 second run, prior CID and CAR link", async () => {
    await page.getByTestId("pub-link-20261110T205226Z").click();
    await expect(page.getByTestId("root-cid")).not.toHaveText(ROOT);
    expect
      .soft(await page.getByTestId("car").locator("a").count(), "required UI CAR release link")
      .toBeGreaterThan(0);
    await page.getByTestId("pub-link-20261110T204914Z").click();
    await expect(page.getByTestId("root-cid")).toHaveText(
      "bafybeig7vgd7ft5woa6sxgnhwjte4he4b762oi7whwmjnrqqhjcjs2d4oa",
    );
  });
  await test.step("PV07 Evanston5mi roofs≥15", async () => {
    await page.goto("/explore");
    await page.getByTestId("lat").fill("42.0451");
    await page.getByTestId("lon").fill("-87.6877");
    await page.getByTestId("radius").fill("5");
    await page.getByTestId("min-roof-age").fill("15");
    await page.getByTestId("search").click();
    await expect(page.getByTestId("search-meta")).toContainText(ROOT);
    await expect(page.getByTestId("result").first()).toContainText("confidence");
  });
  await test.step("PV08 open≥3years contractor/BBB", async () => {
    await page.getByTestId("open-only").check();
    await page.getByTestId("min-open-years").fill("3");
    await page.getByTestId("search").click();
    await expect(page.getByTestId("results")).toContainText("13032280210000");
    await expect(page.getByTestId("results")).toContainText("BBB");
  });
  await test.step("PV09 exact README prompt1", async () => {
    await page.goto("/agent");
    await page.getByTestId("agent-example").first().click();
    await expect(page.getByTestId("msg-agent")).toHaveCount(1, { timeout: 100_000 });
    await expect(page.getByTestId("msg-agent")).toContainText(ROOT);
  });
  await test.step("PV10 exact README follow-up", async () => {
    await page.getByTestId("agent-example").nth(1).click();
    await expect(page.getByTestId("msg-agent")).toHaveCount(2, { timeout: 100_000 });
    await expect(page.getByTestId("msg-agent").last()).toContainText(/contractor|permit/i);
  });
  await test.step("PV11 MCP tool list", async () => {
    await page.goto("/mcp");
    await expect(page.getByTestId("mcp-tools").locator("tbody tr")).toHaveCount(5);
    await expect(page.getByTestId("mcp-tools")).toContainText("findProperties");
  });
});

test("P11 negative: MCP endpoint rejects missing bearer and UI exposes five tool contracts", async ({
  page,
  request,
}) => {
  await page.goto("/mcp");
  await expect(page.getByTestId("mcp-tools").locator("tbody tr")).toHaveCount(5);
  const r = await request.post("/mcp", {
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(r.status()).toBe(401);
});

test("P11 authenticated MCP tool contracts, filter aliases, read-only boundary and source identity", async ({
  baseURL,
}, info) => {
  const token = process.env.MCP_HTTP_AUTH_TOKEN;
  test.skip(
    !token,
    "BLOCKED: inject MCP_HTTP_AUTH_TOKEN in the target test process; never read secrets or record authorization in Playwright traces",
  );
  type ToolResult = {
    result?: {
      tools?: { name: string }[];
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
      content?: { text: string }[];
    };
    error?: unknown;
  };
  const rpc = async (method: string, params?: object): Promise<ToolResult> => {
    // Node fetch deliberately keeps the bearer outside Playwright's request/trace recorder.
    const r = await fetch(`${baseURL}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(line ? line.slice(6) : text) as ToolResult;
  };
  const list = await rpc("tools/list");
  expect(list.result?.tools?.map((x) => x.name).sort()).toEqual([
    "findProperties",
    "getDatasetInfo",
    "getProperty",
    "getSchema",
    "queryDataset",
  ]);
  for (const name of [
    "getDatasetInfo",
    "getSchema",
    "getProperty",
    "queryDataset",
    "findProperties",
  ]) {
    const args =
      name === "getProperty"
        ? { pin14: "13032280210000" }
        : name === "queryDataset"
          ? { sql: SQL, limit: 1 }
          : name === "findProperties"
            ? { lat: 42.0451, lon: -87.6877, radiusMiles: 2, minRoofAge: 150, limit: 5 }
            : {};
    const reply = await rpc("tools/call", { name, arguments: args });
    expect(reply.error).toBeUndefined();
    expect(reply.result?.isError).not.toBe(true);
    const data =
      reply.result?.structuredContent ??
      (JSON.parse(reply.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>);
    const source = data.source as { runId?: string; rootCid?: string };
    expect(source.runId).toBe(RUN);
    expect(source.rootCid).toBe(ROOT);
    await info.attach(`MCP-${name}`, {
      body: JSON.stringify({ tool: name, runId: source.runId, rootCid: source.rootCid }),
      contentType: "application/json",
    });
  }
  for (const args of [
    { sql: "DELETE FROM property", limit: 1 },
    { sql: "SELECT 1; SELECT 2", limit: 1 },
    { sql: "SELECT * FROM read_text('/etc/passwd')", limit: 1 },
  ]) {
    const result = await rpc("tools/call", { name: "queryDataset", arguments: args });
    expect(Boolean(result.error) || result.result?.isError).toBeTruthy();
  }
});
