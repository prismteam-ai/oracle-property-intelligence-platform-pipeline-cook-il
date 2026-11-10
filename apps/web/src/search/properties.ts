import type { Dataset, Row } from '../db/duck.js';
import { ContractorSchema, PermitSchema, PropertySchema } from '../contract.js';
import { FindPropertiesInput, type PropertyWithPermits } from '../mcp/contracts.js';
import { haversineSql, radiusWhere } from './geo.js';

const PROPERTY_COLS = Object.keys(PropertySchema.shape);
const PERMIT_COLS = Object.keys(PermitSchema.shape);
const CONTRACTOR_COLS = Object.keys(ContractorSchema.shape);

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function normalize(row: Row, cols: string[]): Row {
  const out: Row = {};
  for (const c of cols) out[c] = row[c] ?? null;
  for (const c of [
    'lat',
    'lon',
    'year_built',
    'last_sale_price',
    'years_since_sale',
    'roof_age_years',
    'open_days',
  ])
    if (c in out) out[c] = num(out[c]);
  for (const c of ['ingested_at', 'bbb_checked_at']) if (typeof out[c] === 'string') out[c] = String(out[c]);
  return out;
}

async function attachPermits(ds: Dataset, props: Row[]): Promise<PropertyWithPermits[]> {
  const pins = props.map((p) => String(p.pin14));
  const permits = pins.length
    ? await ds.query(
        `SELECT p.*, ${CONTRACTOR_COLS.map((c) => `c.${c} AS c_${c}`).join(', ')}
         FROM permit p LEFT JOIN contractor c ON c.contractor_id = p.contractor_id
         WHERE p.pin14 IN (${pins.map(() => '?').join(',')})
         ORDER BY p.is_roofing DESC, p.status_is_open DESC, p.open_days DESC`,
        pins,
      )
    : [];
  const byPin = new Map<string, PropertyWithPermits['permits']>();
  for (const r of permits) {
    const contractor = r.c_contractor_id
      ? ContractorSchema.parse(
          normalize(Object.fromEntries(CONTRACTOR_COLS.map((c) => [c, r[`c_${c}`]])), CONTRACTOR_COLS),
        )
      : null;
    const permit = { ...PermitSchema.parse(normalize(r, PERMIT_COLS)), contractor };
    const list = byPin.get(String(r.pin14)) ?? [];
    list.push(permit);
    byPin.set(String(r.pin14), list);
  }
  return props.map((p) => ({
    ...PropertySchema.parse(normalize(p, PROPERTY_COLS)),
    distance_miles: num(p.distance_miles),
    permits: byPin.get(String(p.pin14)) ?? [],
  }));
}

export async function findProperties(
  ds: Dataset,
  raw: FindPropertiesInput,
): Promise<{ properties: PropertyWithPermits[]; total_in_radius: number }> {
  const input = FindPropertiesInput.parse(raw);
  const radius = radiusWhere(input.lat, input.lon, input.radiusMiles);
  const where: string[] = [`lat IS NOT NULL AND lon IS NOT NULL AND ${radius.sql}`];
  const params: (string | number)[] = [...radius.params];
  if (input.minRoofAge !== undefined) {
    where.push('roof_age_years >= ?');
    params.push(input.minRoofAge);
  }
  const openPermitSql = `SELECT max(open_days) FROM permit x WHERE x.pin14 = property.pin14 AND x.is_roofing AND x.status_is_open${
    input.minOpenDays !== undefined ? ` AND x.open_days >= ${Math.floor(input.minOpenDays)}` : ''
  }`;
  if (input.openRoofingPermitsOnly) where.push(`(${openPermitSql}) IS NOT NULL`);
  const orderBy = input.openRoofingPermitsOnly
    ? `(${openPermitSql}) DESC, distance_miles ASC`
    : 'distance_miles ASC';
  const sql = `SELECT *, ${haversineSql(input.lat, input.lon)} AS distance_miles, count(*) OVER () AS total_in_radius
    FROM property WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ${input.limit}`;
  const rows = await ds.query(sql, params);
  const properties = await attachPermits(ds, rows);
  return { properties, total_in_radius: Number(rows[0]?.total_in_radius ?? 0) };
}

export async function getProperty(ds: Dataset, pin14: string): Promise<PropertyWithPermits | null> {
  const rows = await ds.query('SELECT *, NULL AS distance_miles FROM property WHERE pin14 = ?', [pin14]);
  if (!rows.length) return null;
  return (await attachPermits(ds, rows))[0] ?? null;
}

export async function tableSchema(
  ds: Dataset,
): Promise<{ name: string; columns: { name: string; type: string }[] }[]> {
  const rows = await ds.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' ORDER BY table_name, ordinal_position`,
  );
  const tables = new Map<string, { name: string; type: string }[]>();
  for (const r of rows) {
    const list = tables.get(String(r.table_name)) ?? [];
    list.push({ name: String(r.column_name), type: String(r.data_type) });
    tables.set(String(r.table_name), list);
  }
  return [...tables].map(([name, columns]) => ({ name, columns }));
}
