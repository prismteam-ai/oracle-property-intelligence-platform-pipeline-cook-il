import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

export const RUN = "20261110T221716Z";
export const ROOT = "bafybeifhz5scgrouns27paizph5zpnlxhovr6vcm6skecu67msh4ffjlaq";
export const EXPECTED_SHA = process.env.EXPECTED_SHA ?? "f2666b9";
export const test = base.extend<{ audit: void }>({
  audit: [
    async ({ page, request }, use, info) => {
      const begin = new Date().toISOString();
      const start = (await (await request.get("/build.json")).json()) as {
        commit: string;
        builtAt: string;
      };
      expect(
        start.commit.startsWith(EXPECTED_SHA),
        "deployed revision matches reviewed baseline",
      ).toBeTruthy();
      const events: object[] = [];
      const errors: string[] = [];
      page.on("pageerror", (e) => {
        events.push({ kind: "pageerror", message: e.message });
        errors.push(e.message);
      });
      page.on("console", (m) => {
        if (m.type() === "error") {
          events.push({ kind: "console", message: m.text() });
          if (
            !info.title.includes("negative") &&
            !(info.title.startsWith("PV") && /400|BAD_REQUEST/.test(m.text()))
          )
            errors.push(m.text());
        }
      });
      page.on("requestfailed", (r) => {
        events.push({ kind: "requestfailed", url: r.url(), error: r.failure()?.errorText });
      });
      page.on("response", (r) => {
        if (r.status() >= 400) events.push({ kind: "http", status: r.status(), url: r.url() });
      });
      await use();
      const end = (await (await request.get("/build.json")).json()) as {
        commit: string;
        builtAt: string;
      };
      await info.attach("run-evidence", {
        body: JSON.stringify(
          {
            begin,
            end: new Date().toISOString(),
            test: info.title,
            project: info.project.name,
            buildStart: start,
            buildEnd: end,
            run: RUN,
            rootCid: ROOT,
            events,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(end.commit, "deployment must not drift during the case").toBe(start.commit);
      expect(errors, "unexpected browser/console errors; see evidence attachment").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function inventory(page: Page, info: TestInfo, route: string) {
  const controls = await page
    .locator('a,button,input,select,textarea,summary,[role="button"],[role="application"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const e = node as HTMLElement;
        return {
          tag: e.tagName,
          id: e.dataset.testid ?? null,
          role: e.getAttribute("role"),
          label: e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 100),
          type: e.getAttribute("type"),
          href: e.getAttribute("href"),
          disabled: e.hasAttribute("disabled"),
        };
      }),
    );
  await info.attach(`control-inventory-${route.replace(/\W/g, "_")}`, {
    body: JSON.stringify({ route, controls }, null, 2),
    contentType: "application/json",
  });
}
export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "no horizontal page overflow",
  ).toBeTruthy();
}
export async function query(page: Page, sql: string, limit = 100) {
  await page.getByTestId("sql").fill(sql);
  await page.getByTestId("limit").fill(String(limit));
  const response = page.waitForResponse(
    (r) => r.url().includes("/trpc/query.sql") && r.request().method() === "POST",
  );
  await page.getByTestId("run-sql").click();
  return response;
}

export function rpcData<T>(body: unknown): T {
  const first: unknown = Array.isArray(body) ? body[0] : body;
  return (first as { result: { data: T } }).result.data;
}
