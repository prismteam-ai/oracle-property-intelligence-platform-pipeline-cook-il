import { describe, expect, it } from "vitest";
import { classifyRoofing, isOpen } from "./roofing.js";

describe("classifyRoofing", () => {
  it.each([
    ["REROOF", true],
    ["re-roof existing garage", true],
    ["TEAR OFF AND REPLACE SHINGLES", true],
    ["tearoff roofing", true],
    ["New roof", true],
    ["ROOFING REPAIR", true],
    ["Roof deck replacement", false],
    ["ROOFTOP UNIT", false],
    ["green roof install", false],
    ["ROOF MOUNTED SOLAR PANELS", false],
    ["FENCE", false],
    ["FIREPROOFING", false],
    ["", false],
    [null, false],
  ])("%s -> %s", (desc, expected) => {
    expect(classifyRoofing(desc).is_roofing).toBe(expected);
  });
  it("stores the rule text on a match and the exclusion on a near miss", () => {
    expect(classifyRoofing("REROOF").roofing_match_rule).toContain("RE-?ROOF");
    expect(classifyRoofing("ROOF DECK").roofing_match_rule).toMatch(/^excluded:/);
    expect(classifyRoofing("FENCE").roofing_match_rule).toBeNull();
  });
});

describe("isOpen", () => {
  it("uses per-source closed sets", () => {
    expect(isOpen("cook_assessor_permits", "PENDING", null)).toBe(true);
    expect(isOpen("cook_assessor_permits", "closed", null)).toBe(false);
    expect(isOpen("chicago_permits", "ACTIVE", null)).toBe(true);
    expect(isOpen("chicago_permits", "COMPLETE", null)).toBe(false);
  });
  it("never reports unknown status or closed_at rows as open", () => {
    expect(isOpen("chicago_permits", null, null)).toBe(false);
    expect(isOpen("chicago_permits", "ACTIVE", "2024-01-01")).toBe(false);
  });
});
