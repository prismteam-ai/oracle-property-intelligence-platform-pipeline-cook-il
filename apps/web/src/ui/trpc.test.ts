import { describe, expect, it } from "vitest";
import { fmtTs } from "./trpc.js";

describe("fmtTs", () => {
  it("renders naive DuckDB, offset and Z timestamps as UTC with a Z suffix", () => {
    expect(fmtTs("2026-11-10 22:17:16.158255")).toBe("2026-11-10T22:17:16Z");
    expect(fmtTs("2026-11-11T00:17:16+02:00")).toBe("2026-11-10T22:17:16Z");
    expect(fmtTs("2026-11-10T20:53:04.370Z")).toBe("2026-11-10T20:53:04Z");
    expect(fmtTs(null)).toBe("—");
    expect(fmtTs("not a date")).toBe("not a date");
  });
});
