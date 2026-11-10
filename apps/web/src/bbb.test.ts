import { describe, expect, it } from "vitest";
import { bbbLabel } from "./bbb.js";

describe("bbbLabel", () => {
  it("uses one wording per bbb_state", () => {
    expect(
      bbbLabel({ bbb_rating: "A+", bbb_state: "stale", bbb_checked_at: "2026-06-13T10:00:00Z" }),
    ).toBe("BBB A+ (archived copy, 2026-06-13)");
    expect(
      bbbLabel({ bbb_rating: null, bbb_state: "unavailable", bbb_reason: "access_boundary_403" }),
    ).toBe("BBB: not available (access_boundary_403)");
    expect(bbbLabel({ bbb_rating: null, bbb_state: "unknown" })).toBe("BBB: unknown (not checked)");
    expect(bbbLabel({ bbb_rating: "B", bbb_state: "confirmed_present" })).toBe("BBB B");
    expect(bbbLabel({ bbb_rating: null, bbb_state: "confirmed_empty" })).toBe(
      "BBB: not available (profile has no rating)",
    );
    expect(bbbLabel(null)).toBe("BBB: not available (no contractor match)");
  });
});
