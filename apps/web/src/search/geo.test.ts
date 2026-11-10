import { describe, expect, it } from 'vitest';
import ngeohash from 'ngeohash';
import { geohashPrefixes, haversineMiles, precisionForRadius, radiusWhere } from './geo.js';

describe('haversineMiles', () => {
  it('Chicago Loop to Evanston ~ 12.5 miles', () => {
    const d = haversineMiles(41.8781, -87.6298, 42.0451, -87.6877);
    expect(d).toBeGreaterThan(11.5);
    expect(d).toBeLessThan(13.5);
  });
  it('zero distance', () => {
    expect(haversineMiles(41.9, -87.7, 41.9, -87.7)).toBe(0);
  });
});

describe('geohash prefilter', () => {
  it('chooses coarser precision for larger radius', () => {
    expect(precisionForRadius(0.3)).toBe(6);
    expect(precisionForRadius(2)).toBe(5);
    expect(precisionForRadius(5)).toBe(4);
    expect(precisionForRadius(50)).toBe(3);
  });
  it('prefixes cover every point within the radius', () => {
    const lat = 41.8781;
    const lon = -87.6298;
    for (const radius of [0.5, 1, 3, 5, 10]) {
      const { precision, prefixes } = geohashPrefixes(lat, lon, radius);
      for (let i = 0; i < 400; i++) {
        const ang = (i / 400) * 2 * Math.PI;
        const dLat = (radius / 69.0) * Math.cos(ang);
        const dLon = (radius / (69.0 * Math.cos((lat * Math.PI) / 180))) * Math.sin(ang);
        const h = ngeohash.encode(lat + dLat, lon + dLon, 6).slice(0, precision);
        expect(prefixes).toContain(h);
      }
    }
  });
  it('radiusWhere returns 9 prefixes plus the radius param', () => {
    const { sql, params } = radiusWhere(41.9, -87.7, 2);
    expect(params).toHaveLength(10);
    expect(sql).toMatch(/substr\(geohash6, 1, 5\) IN/);
  });
});
