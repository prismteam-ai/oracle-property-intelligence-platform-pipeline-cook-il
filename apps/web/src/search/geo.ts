import ngeohash from 'ngeohash';

export const EARTH_RADIUS_MILES = 3958.7613;

export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

/** Geohash precision whose cell height (km) covers the radius, so center + 8 neighbours cover the circle. */
export function precisionForRadius(radiusMiles: number): number {
  const km = radiusMiles * 1.609344;
  // smallest cell dimension in km per precision (w x h): 3:156x156 4:39x19.5 5:4.9x4.9 6:1.2x0.61
  if (km <= 0.55) return 6;
  if (km <= 4.4) return 5;
  if (km <= 17.5) return 4;
  if (km <= 140) return 3;
  return 2;
}

/** Geohash prefixes (center + 8 neighbours) that enclose a circle; used as `substr(geohash6,1,p) IN (...)`. */
export function geohashPrefixes(
  lat: number,
  lon: number,
  radiusMiles: number,
): { precision: number; prefixes: string[] } {
  const precision = precisionForRadius(radiusMiles);
  const center = ngeohash.encode(lat, lon, precision);
  return { precision, prefixes: [center, ...ngeohash.neighbors(center)] };
}

/** SQL fragment + params for the radius prefilter and exact haversine on columns lat/lon/geohash6. */
export function radiusWhere(
  lat: number,
  lon: number,
  radiusMiles: number,
): { sql: string; params: (string | number)[] } {
  const { precision, prefixes } = geohashPrefixes(lat, lon, radiusMiles);
  const placeholders = prefixes.map(() => '?').join(', ');
  return {
    sql: `substr(geohash6, 1, ${precision}) IN (${placeholders}) AND ${haversineSql(lat, lon)} <= ?`,
    params: [...prefixes, radiusMiles],
  };
}

export function haversineSql(lat: number, lon: number): string {
  const la = Number(lat);
  const lo = Number(lon);
  return `(2 * ${EARTH_RADIUS_MILES} * asin(sqrt(pow(sin(radians(lat - (${la})) / 2), 2) + cos(radians(${la})) * cos(radians(lat)) * pow(sin(radians(lon - (${lo})) / 2), 2))))`;
}
