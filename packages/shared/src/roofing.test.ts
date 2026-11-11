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
    // real Chicago/Cook descriptions (2026-11-11 Slowking finding: 201 N Clark, permit 100947350)
    [
      "INTERIOR DEMOLITION OF NON LOAD BEARING PARTITIONS ... DEMOLITION OF MECHANICAL EQUIPMENT SERVING LEVELS 1 AND 2 LOCATED ON LEVEL 2 ROOF AREAS AS PER PLANS. NO STRUCTURAL WORK.",
      false,
    ],
    ["REPLACE (1) ROOF TOP UNIT.", false],
    ["REPLACE ROOF TOP UNIT", false],
    ["INSTALLATION OF LOW VOLTAGE EQUIPMENT ON ROOF", false],
    ["REMOVE AND REPLACE EXISTING CELL ANTENNAS AND RADIO EQUIPMENT ON ROOF.", false],
    ["NEW DETACHED WOOD FRAME GARAGE. GABLE ROOF HEIGHT TO PEAK 13-0 .", false],
    ["ERECT A DETACHED FRAME GARAGE 20 X 25 X 14 WITH 2 SQ. FT. ROOF VENTS.", false],
    ["ROOF", true],
    ["FLAT ROOF", true],
    ["ROOF RECOVER ONLY - NO STRUCTURAL WORK", true],
    ["REMOVE AND REPLACE FLAT ROOF.ALL WORK SAME AS EXTISTING. NO STRUCTURAL", true],
    ["REPLACE ROOF (NO MEP) (NO STRUCTURAL WORK)- ALL WORK SAME AS EXISTING", true],
    ["ROOF REPLACEMENT AND INSTALLATION OF ROOF ANCHORS.", true],
    ["REROOF AND INSTALL SOLAR PANELS", true],
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
