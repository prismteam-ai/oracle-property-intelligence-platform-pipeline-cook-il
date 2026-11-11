const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const EARTH_RADIUS_M = 6_371_008.8;

export function geohash(lat: number, lon: number, precision = 6): string {
  let latMin = -90,
    latMax = 90,
    lonMin = -180,
    lonMax = 180;
  let bit = 0,
    ch = 0,
    even = true,
    out = "";
  while (out.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        ch = (ch << 1) | 1;
        lonMin = mid;
      } else {
        ch <<= 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}

export const geohash6 = (lat: number, lon: number): string => geohash(lat, lon, 6);

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** geohash6 cells are ~1.2km x 0.6km; neighbours of the centre cell cover any radius <= ~600m.
 *  For bigger radii, callers use a bounding box on lat/lon instead (see boundingBox). */
export function boundingBox(lat: number, lon: number, radiusMeters: number) {
  const dLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return { latMin: lat - dLat, latMax: lat + dLat, lonMin: lon - dLon, lonMax: lon + dLon };
}

export function isValidCookCoordinate(lat: number | null, lon: number | null): lat is number {
  // Cook County, IL bounding box with margin
  return lat !== null && lon !== null && lat > 41.4 && lat < 42.2 && lon > -88.3 && lon < -87.4;
}
