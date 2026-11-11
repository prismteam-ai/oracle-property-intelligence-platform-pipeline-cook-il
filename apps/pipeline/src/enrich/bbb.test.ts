import { describe, expect, it } from "vitest";
import { Duck } from "@cook/duck";
import pino from "pino";
import {
  BBB_ORIGIN,
  CDX_URL,
  buildSlugIndex,
  harvestBbb,
  nameKeys,
  parseProfile,
  parseRobots,
  robotsAllows,
  type Fetch,
} from "./bbb.js";

const log = pino({ level: "silent" });
const ROBOTS = "User-agent: *\nDisallow: /*?\nDisallow: /search\nAllow: /us/\n";
const PROFILE = (rating: string, accredited: boolean) =>
  `<html><script>{"accredited":${accredited},"rating":"${rating}"}</script><body><h1>Davis Roofing &amp; Construction</h1>
   <p>Davis Roofing is ${accredited ? "" : "not "}BBB Accredited.</p><div>BBB Rating</div><span>${rating}</span></body></html>`;
const DAVIS = `${BBB_ORIGIN}/us/il/addison/profile/roofing-contractors/davis-roofing-construction-0654-88376154`;
const TEAM = `${BBB_ORIGIN}/us/il/chicago/profile/roofing-contractors/team-roofing-co-0654-1`;
const CDX = JSON.stringify([
  ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
  ["k", "20210501090337", DAVIS, "text/html", "200", "x", "1"],
  ["k", "20250516214738", DAVIS, "text/html", "200", "x", "1"],
  ["k", "20250813203907", `${DAVIS}/customer-reviews`, "text/html", "200", "x", "1"],
  ["k", "20240101000000", TEAM, "text/html", "200", "x", "1"],
  [
    "k",
    "20240101000000",
    `${BBB_ORIGIN}/us/il/chicago/profile/roofing-contractors/team-roofing-co-0654-2`,
    "text/html",
    "200",
    "x",
    "1",
  ],
]);

async function seed(): Promise<Duck> {
  const db = await Duck.open();
  await db.exec(`create table contractor(contractor_id varchar, name varchar, dba varchar, license_status varchar,
    bbb_state varchar, bbb_rating varchar, bbb_url varchar, bbb_checked_at timestamp)`);
  await db.exec(`insert into contractor values
    ('idfpr:1', 'DAVIS ROOFING & CONSTRUCTION INC', null, 'ACTIVE', 'unknown', null, null, null),
    ('idfpr:2', 'TEAM ROOFING CO', null, 'ACTIVE', 'unknown', null, null, null),
    ('idfpr:3', 'NOBODY LLC', null, 'ACTIVE', 'unknown', null, null, null),
    ('idfpr:4', 'LONELY INC', null, 'NOT RENEWED', 'unknown', null, null, null)`);
  await db.exec(
    `create table property_improvement_has_contractor(permit_id varchar, contractor_id varchar)`,
  );
  await db.exec(`insert into property_improvement_has_contractor values
    ('p1','idfpr:1'),('p2','idfpr:1'),('p3','idfpr:2'),('p4','idfpr:3'),('p5','idfpr:3'),('p6','idfpr:3'),('p7','idfpr:4')`);
  return db;
}

function fakeFetch(
  routes: Record<string, { status: number; body?: string }>,
  calls: string[] = [],
): Fetch {
  return (url, init) => {
    calls.push(url);
    expect(init.headers["User-Agent"]).toMatch(/cook-il/);
    const r = routes[url] ?? { status: 404 };
    return Promise.resolve({ status: r.status, text: () => Promise.resolve(r.body ?? "") });
  };
}

describe("bbb parsing", () => {
  it("parses robots and applies longest-match rules", () => {
    const rules = parseRobots(ROBOTS);
    expect(robotsAllows(rules, "/us/il/x/profile/roofing-contractors/y")).toBe(true);
    expect(robotsAllows(rules, "/search?find_text=roof")).toBe(false);
    expect(robotsAllows(rules, "/us/il/search?x=1")).toBe(true); // longest match wins (Allow: /us/); we never send query strings
    expect(robotsAllows(rules, "/search")).toBe(false);
  });
  it("reads rating and accreditation from profile text, JSON as fallback", () => {
    expect(parseProfile(PROFILE("A+", true))).toEqual({ rating: "A+", accredited: true });
    expect(parseProfile(PROFILE("NR", false))).toEqual({ rating: "NR", accredited: false });
    expect(parseProfile('<script>{"accredited":false,"rating":"B-"}</script>')).toEqual({
      rating: "B-",
      accredited: false,
    });
    expect(parseProfile("<p>nothing</p>")).toEqual({ rating: null, accredited: null });
  });
  it("matches names to archived slugs ignoring suffixes and '&', keeping the latest capture", () => {
    const idx = buildSlugIndex(JSON.parse(CDX) as string[][]);
    const keys = nameKeys("Davis Roofing & Construction, Inc.");
    const hit = [...keys].flatMap((k) => idx.get(k) ?? [])[0];
    expect(hit).toEqual({ url: DAVIS, timestamp: "20250516214738" });
    expect(idx.get("teamroofing")?.length).toBe(2); // two distinct profiles -> ambiguous
  });
});

describe("harvestBbb", () => {
  it("stops bbb.org requests at the first 403, reads archive copies as stale and records reasons", async () => {
    const db = await seed();
    const calls: string[] = [];
    const fetch = fakeFetch(
      {
        [`${BBB_ORIGIN}/robots.txt`]: { status: 403, body: "Just a moment" },
        [CDX_URL]: { status: 200, body: CDX },
        [`https://web.archive.org/web/20250516214738id_/${DAVIS}`]: {
          status: 200,
          body: PROFILE("A+", true),
        },
      },
      calls,
    );
    const now = () => new Date("2026-11-10T12:00:00Z");
    const r = await harvestBbb(db, { limit: 10, minPermits: 2, log, fetch, delayMs: 0, now });
    expect(r.candidates).toBe(2); // idfpr:2 has one permit, idfpr:4 one permit
    expect(r.blocks).toEqual([
      { status: 403, url: `${BBB_ORIGIN}/robots.txt`, at: now().toISOString() },
    ]);
    expect(calls.filter((u) => u.startsWith(BBB_ORIGIN))).toEqual([`${BBB_ORIGIN}/robots.txt`]);
    expect(r.states).toEqual({ stale: 1, unavailable: 1 });
    expect(r.ratings).toEqual({ "A+": 1 });
    const rows = await db.query("select * from contractor order by contractor_id");
    expect(rows[0]).toMatchObject({
      bbb_state: "stale",
      bbb_rating: "A+",
      bbb_url: DAVIS,
      bbb_source: "archive",
      bbb_reason: "access_boundary_403",
    });
    expect(rows[2]).toMatchObject({
      bbb_state: "unavailable",
      bbb_rating: null,
      bbb_reason: "access_boundary_403",
    });
    expect(rows[1]!["bbb_state"]).toBe("unknown");
    expect(
      await db.scalar(
        "select bbb_archive_timestamp from bbb_lookup where contractor_id = 'idfpr:1'",
      ),
    ).toBe("20250516214738");

    // rerun within 30 days: nothing refetched
    const again = await harvestBbb(db, { limit: 10, minPermits: 2, log, fetch, delayMs: 0, now });
    expect(again.candidates).toBe(0);
    expect(again.skipped_recent).toBe(2);
    expect(calls.length).toBe(3);
  });

  it("uses live allowed profile paths when robots permits and marks ambiguous slugs", async () => {
    const db = await seed();
    const calls: string[] = [];
    const fetch = fakeFetch(
      {
        [`${BBB_ORIGIN}/robots.txt`]: { status: 200, body: ROBOTS },
        [CDX_URL]: { status: 200, body: CDX },
        [DAVIS]: { status: 200, body: PROFILE("B", false) },
      },
      calls,
    );
    const r = await harvestBbb(db, { limit: 10, minPermits: 1, log, fetch, delayMs: 0 });
    expect(r.candidates).toBe(4);
    expect(r.blocks).toEqual([]);
    expect(r.states).toEqual({ confirmed_present: 1, unavailable: 3 });
    const reasons = await db.query<{
      contractor_id: string;
      bbb_reason: string | null;
      bbb_source: string | null;
    }>("select contractor_id, bbb_reason, bbb_source from contractor order by 1");
    expect(reasons).toEqual([
      { contractor_id: "idfpr:1", bbb_reason: null, bbb_source: "live" },
      { contractor_id: "idfpr:2", bbb_reason: "ambiguous_name_slug", bbb_source: null },
      { contractor_id: "idfpr:3", bbb_reason: "no_archived_profile_url", bbb_source: null },
      { contractor_id: "idfpr:4", bbb_reason: "no_archived_profile_url", bbb_source: null },
    ]);
    expect(calls.some((u) => u.includes("?") && u.startsWith(BBB_ORIGIN))).toBe(false);
  });

  it("retries transient failures and never records them", async () => {
    const db = await seed();
    const calls: string[] = [];
    let archiveTries = 0;
    const fetch: Fetch = (url) => {
      calls.push(url);
      if (url === CDX_URL)
        return Promise.resolve({ status: 200, text: () => Promise.resolve(CDX) });
      if (url.startsWith("https://web.archive.org/web/")) {
        archiveTries++;
        return Promise.resolve({ status: 503, text: () => Promise.resolve("") });
      }
      return Promise.resolve({ status: 403, text: () => Promise.resolve("") });
    };
    const r = await harvestBbb(db, { limit: 1, minPermits: 3, log, fetch, delayMs: 0 });
    expect(r.candidates).toBe(1);
    expect(r.transient_failures).toBe(0); // idfpr:3 has no slug at all
    const r2 = await harvestBbb(db, { limit: 10, minPermits: 2, log, fetch, delayMs: 0 });
    expect(archiveTries).toBe(4);
    expect(r2.transient_failures).toBe(1);
    expect(await db.scalar("select count(*) from bbb_lookup where contractor_id = 'idfpr:1'")).toBe(
      0,
    );
    const down: Fetch = () => Promise.resolve({ status: 503, text: () => Promise.resolve("") });
    await expect(
      harvestBbb(db, { limit: 10, minPermits: 1, log, fetch: down, delayMs: 0 }),
    ).rejects.toThrow(/CDX/);
  });
});
