import { afterAll, beforeAll, expect, it } from "vitest";
import { Duck } from "@cook/duck";
import { findSource, SOURCES, sourceRecordUrlSql } from "@cook/shared";

let db: Duck;
beforeAll(async () => {
  db = await Duck.open(":memory:");
});
afterAll(() => db.close());

it("uses each actual source key field, never an unnamed query argument", async () => {
  for (const s of SOURCES) {
    const key = s.keyFields.length === 2 ? "10253260360000|2026" : "A & B+'雪?/#%=x";
    const url = new URL(String(await db.scalar(`select ${sourceRecordUrlSql(s, "$1")}`, [key])));
    expect(url.pathname).toBe(`/resource/${s.datasetId}.json`);
    expect([...url.searchParams.keys()]).toEqual(s.keyFields);
    expect([...url.searchParams.values()]).toEqual(key.split("|"));
    expect(url.hash).toBe("");
  }
});

it("uses explicit Socrata :id for raw rows missing natural key fields", async () => {
  const url = new URL(
    String(
      await db.scalar(`select ${sourceRecordUrlSql(findSource("idfpr_roofing"), "$1", "true")}`, [
        "row-test/id '&?",
      ]),
    ),
  );
  expect([...url.searchParams]).toEqual([["$where", ":id='row-test/id ''&?'"]]);
});
