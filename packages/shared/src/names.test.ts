import { describe, expect, it } from "vitest";
import { normalizeName, stripSuffixes } from "./names.js";

describe("normalizeName", () => {
  it("uppercases, expands ampersand, strips punctuation and squeezes spaces", () => {
    expect(normalizeName("  A&B Roofing, Inc.")).toBe("A AND B ROOFING INC");
    expect(normalizeName(null)).toBe("");
  });
});

describe("stripSuffixes", () => {
  it("removes corporate suffixes and articles", () => {
    expect(stripSuffixes("THE ROOF CO INC")).toBe("ROOF");
    expect(stripSuffixes("TEAM ROOFING LLC")).toBe("TEAM ROOFING");
    expect(stripSuffixes("JOHN SMITH")).toBe("JOHN SMITH");
  });
});
