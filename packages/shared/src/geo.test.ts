import { describe, expect, it } from "vitest";
import { boundingBox, geohash, geohash6, haversineMeters, isValidCookCoordinate } from "./geo.js";

describe("geohash", () => {
  it("matches reference vectors", () => {
    expect(geohash(42.6, -5.6, 5)).toBe("ezs42");
    expect(geohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
    expect(geohash6(41.8781, -87.6298)).toBe("dp3wjz"); // Chicago Loop
  });
});

describe("haversineMeters", () => {
  it("measures Chicago Loop to O'Hare at ~24.6 km", () => {
    const d = haversineMeters(41.8781, -87.6298, 41.9742, -87.9073);
    expect(d).toBeGreaterThan(24_000);
    expect(d).toBeLessThan(25_500);
  });
  it("is zero for identical points", () => {
    expect(haversineMeters(41, -87, 41, -87)).toBe(0);
  });
});

describe("boundingBox", () => {
  it("contains points within the radius", () => {
    const b = boundingBox(41.8781, -87.6298, 8047); // 5 miles
    expect(b.latMin).toBeLessThan(41.81);
    expect(b.latMax).toBeGreaterThan(41.94);
    expect(b.lonMin).toBeLessThan(-87.72);
  });
});

describe("isValidCookCoordinate", () => {
  it("rejects nulls, zeros and far-away points", () => {
    expect(isValidCookCoordinate(null, null)).toBe(false);
    expect(isValidCookCoordinate(0, 0)).toBe(false);
    expect(isValidCookCoordinate(41.88, -87.63)).toBe(true);
    expect(isValidCookCoordinate(40.0, -87.63)).toBe(false);
  });
});
