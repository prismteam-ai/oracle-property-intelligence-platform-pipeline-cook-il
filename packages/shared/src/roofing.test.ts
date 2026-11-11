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

const COOK = { sourceSystem: "cook_assessor_permits", permitType: "RESIDENTIAL PERMIT" };
const EASY = { sourceSystem: "chicago_permits", permitType: "PERMIT - EASY PERMIT PROCESS" };
const EXPRESS = {
  sourceSystem: "chicago_permits",
  permitType: "PERMIT \u2013 EXPRESS PERMIT PROGRAM",
};
const RENO = { sourceSystem: "chicago_permits", permitType: "PERMIT - RENOVATION/ALTERATION" };
const MULTI_SCOPE_EASY =
  "REPLACE WINDOWS, EXTERIOR DOORS, ROOFING AND SHEET METAL, TRIM WORK, FLOORING AND PLUMBING FIXTURES THROUGHOUT. REPLACE FURNACES AND  ADD AC CONDENSERS, PAINT INTERIOR AND GENERAL REPAIRS THROUGHOUT PER PLANS.";

// real long-open permits from the 2026-11-11 precision review (docs/evidence/roofing-classifier-precision.md)
describe("classifyRoofing with permit context", () => {
  it.each([
    // Cook Assessor short descriptions stay roofing
    ["REROOF SFR", COOK, true],
    ["ROOF RESIDENTIAL", COOK, true],
    ["ROOF", COOK, true],
    ["FLAT ROOF", COOK, true],
    ["ROOF RECOVER ONLY - NO STRUCTURAL WORK", COOK, true],
    ["INSTALL NEW ROOF ON NEW 12 UNIT BUILDING", COOK, true],
    ["RE-ROOF EAST SIDE OF DORMER, OVER EXISTING.", COOK, true],
    ["TEAR OFF AND REROOF ON HOUSE AND DETACHED GARAGE. NO FLAT ROOF WORK.", COOK, true],
    // Chicago reroof tracks keep the general rule; the en dash in the Express type is matched too
    ["TEAR OFF AND REPLACE ROOF", EASY, true],
    [MULTI_SCOPE_EASY, EASY, true],
    [
      "SCOPE: ROOF REPLACEMENT. AREA: 122927 SQ. FT. ROOF COVERING: BUILT-UP ROOF. LOCATION: R30 INSULATION REQUIRED. IL ROOFING CONTRACTOR LICENSE: 104019224.",
      EXPRESS,
      true,
    ],
    ["TO INSTALL A 5.2KW PV ARRAY ROOF-MOUNTED SYSTEM WITH A MAIN PANEL UPGRADE", EXPRESS, false],
    // other Chicago permit types: only a roof job counts
    ["replace shingles", RENO, true],
    [
      "REPAIR REPLACE ROOF AND ROOF DRAINS OF EXISTING UNOCCUPIED CTA ELECTRICAL SUBSTATION",
      RENO,
      true,
    ],
    [MULTI_SCOPE_EASY, RENO, false],
    ["ROOF", RENO, false],
    ["ROOF", { sourceSystem: "chicago_permits", permitType: null }, false],
    [
      "DECONVERT FROM MULTI-FAMILY TO SINGLE FAMILY FRAME RESIDENCE WITH BASEMENT, NEW ROOF AND NEW PORCH, PER PLANS.",
      RENO,
      false,
    ],
    [
      "SPR 2019 CBRC - INTERIOR BUILDOUT FOR NEW CARRY OUT RESTAURANT IN EXISTING 1 STORY MASONRY BUILDING, NEW ROOF, NEW PARKING LAYOUT, CHANGE USE FROM OFFICE TO CARRY OUT RESTAURANT AS PER PLAN.",
      RENO,
      false,
    ],
    ["REBUILD REAR PORCH AS PER PLANS (NEW ROOF)", RENO, false],
    // exclusions that hold for every feed
    [
      "EXISTING 3 STORY W/BSMT-10 D.U. MASONRY RESIDENTIAL BUILDING - INTERIOR DEMO ONLY - NO STRUCTURAL PARTITIONS, FOUNDATION, ROOF, EXTERIOR OR GARAGE WORK. FULL REHAB PERMIT TO BE APPLIED FOR WITHIN 60 DAYS.",
      COOK,
      false,
    ],
    [
      "NEW ROOF STRUCTURE OVER EXISTING OUTDOOR PATIO (PREVIOUSLY PERMITTED 100632977) PER ARCHITECTURAL PLANS.",
      COOK,
      false,
    ],
    [
      "FULL BUILDING PERMIT FOR 3 STORY + BASEMENT FULLY SPRINKLERED SINGLE FAMILY HOME WITH DETACHED 2-CAR GARAGE. OCCUPIABLE ROOF TERRACES ON GARAGE AND HOME. GARAGE IS ALL MASONRY CONSTRUCTION W/ WOOD JOIST ROOF AND MASONRY PARTY WALL ON ONE SIDE.",
      COOK,
      false,
    ],
    [
      "EXISTING 2 D.U. INTERIOR REMODEL PER PLANS. NEW MECHANICAL, ELECTRICAL AND PLUMBING PER PLANS. NEW ROOF DORMER PER PLANS.",
      COOK,
      false,
    ],
    [
      "SPR 2019 CBC, RENOVATION OF EXISTING FRAMED 2 STORY RESIDENTIAL SINGLE FAMILY HOME, INCLUDING THE ADDITION OF DORMER AT ROOF.",
      COOK,
      false,
    ],
    [
      "2019 CBCR-5 MULTI-UNIT RESIDENCE / R-5 MULTI-UNIT RESIDENCEPROVIDE AIR CONDITIONING TO EACH DWELLING UNIT (68 D.U.)INSTALL A/C CONDENSING UNITS ON EXISTING ROOF",
      COOK,
      false,
    ],
    ["REBUILD EXISTING PORCH AS PER PLANS (ROOF STAYS)", COOK, false],
    ["ERECT NEW OPEN PORCH NO ROOF PER PLAN", COOK, false],
    ["REBUILD CHIMNEY FROM ROOF LINE UP. SAME HEIGHT AS EXISTING.", COOK, false],
    [
      "FIRE RESTORARTION TO 2ND FLOOR. (NO ROOFING WORK, NO ALTERATIONS, NO PLUMBING WORK)",
      EASY,
      false,
    ],
  ] as const)("%s (%o) -> %s", (desc, ctx, expected) => {
    expect(classifyRoofing(desc, ctx).is_roofing).toBe(expected);
  });

  it("names the rule or exclusion that decided", () => {
    expect(classifyRoofing("REROOF", RENO).roofing_match_rule).toMatch(/^chicago permit_type !~/);
    expect(classifyRoofing("ROOF", RENO).roofing_match_rule).toMatch(/^excluded:.*needs/);
    expect(classifyRoofing(MULTI_SCOPE_EASY, RENO).roofing_match_rule).toMatch(
      /^excluded:.*multi-scope.*INTERIOR/,
    );
    expect(classifyRoofing("NO ROOFING WORK", EASY).roofing_match_rule).toMatch(/^excluded:.*NO/);
    expect(classifyRoofing("REROOF", EASY).roofing_match_rule).toBe(
      classifyRoofing("REROOF").roofing_match_rule,
    );
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
