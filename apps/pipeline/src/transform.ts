import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { quoteString, type Duck } from "@cook/duck";
import {
  CLOSED_STATUSES,
  CONTRACT_TABLES,
  ROOFING_EXCLUDE,
  ROOFING_INCLUDE,
  ROOFING_RULE,
  SQL_NORMALIZE_NAME,
  SQL_STRIP_SUFFIXES,
  type Delta,
} from "@cook/shared";
import type { Logger } from "./log.js";
import { findSource, sourceUrl } from "./sources.js";

const q = quoteString;
const COOK_ZIP3 = ["600", "601", "602", "603", "604", "605", "606", "607", "608"];
const PK: Record<string, string> = {
  property: "pin14",
  permit: "permit_id",
  contractor: "contractor_id",
  business: "license_id",
  sale: "sale_id",
};
const inList = (xs: readonly string[]) => xs.map(q).join(", ");

export const LIMITATIONS = [
  "Cook County Clerk recordings (deeds, mortgages, liens) have no bulk/API export; ownership comes from Assessor mailing-name and sales data instead.",
  "Cook County Treasurer tax-payment data is not available in bulk; not loaded.",
  "Chicago trade/contractor licenses are published as HTML search only; contractor identity is resolved against the IDFPR roofing roster (statewide).",
  "Suburban municipal permit portals (130+ jurisdictions) are not bulk-available; suburban permits come from the Assessor permit feed which lacks close dates (closed_at is null; CLOSED status is the terminal signal).",
  "Chicago building permits have no close date; status COMPLETE/EXPIRED/CANCELLED/REVOKED is terminal; 303k pre-2006 permits have no status and are never reported as open.",
  "BBB ratings are not harvested yet (bbb_state='unknown' for every contractor).",
  "Property coordinates are parcel centroids from the Assessor Parcel Universe; permits without lat/lon are geocoded by PIN to the parcel centroid.",
];

export interface TransformResult {
  counts: Record<string, number>;
  deltas: Record<string, Delta>;
  parquet_dir: string;
}

export async function transform(
  db: Duck,
  o: { dataDir: string; runId: string; log: Logger; asOf?: string },
): Promise<TransformResult> {
  const asOf = o.asOf ?? new Date().toISOString().slice(0, 10);
  const runId = o.runId;
  const step = async (name: string, sql: string) => {
    const t0 = Date.now();
    await db.exec(sql);
    o.log.info({ step: name, ms: Date.now() - t0 }, "transform step");
  };
  await snapshotPrevious(db);
  await step("sale", saleSql(runId));
  await step("contractor", contractorSql(runId));
  await step("business", businessSql(runId));
  await step("property_base", propertyBaseSql(runId, asOf));
  await step("contractor_name_index", contractorIndexSql());
  for (const [i, sql] of permitSql(runId, asOf).entries()) await step(`permit_${i}`, sql);
  await step("roof_age", roofAgeSql(asOf));
  await fillGeohash(db, o.log);
  await step(
    "property_hash",
    `update property set source_record_hash = sha256(source_record_hash || coalesce(roof_age_basis, '') || coalesce(cast(roof_age_anchor_date as varchar), '') || coalesce(cast(roof_age_years as varchar), ''))`,
  );
  const deltas: Record<string, Delta> = {};
  const counts: Record<string, number> = {};
  for (const t of CONTRACT_TABLES) {
    if (!(t in PK)) continue;
    deltas[t] = await reconcile(db, t, PK[t]!);
    counts[t] = await db.count(t);
  }
  await db.exec("drop table if exists contractor_name_index");
  const parquetDir = await exportParquet(db, o.dataDir, runId, o.log);
  return { counts, deltas, parquet_dir: parquetDir };
}

async function snapshotPrevious(db: Duck): Promise<void> {
  for (const [t, pk] of Object.entries(PK)) {
    if (await db.tableExists(t)) {
      await db.exec(
        `create or replace temp table prev_${t} as select ${pk} as pk, source_record_hash, ingested_at, run_id from ${t}`,
      );
    } else {
      await db.exec(
        `create or replace temp table prev_${t}(pk varchar, source_record_hash varchar, ingested_at timestamp, run_id varchar)`,
      );
    }
  }
}

/** Deltas by hash vs previous snapshot; unchanged rows keep their original ingested_at/run_id. */
async function reconcile(db: Duck, t: string, pk: string): Promise<Delta> {
  const r = await db.one<{ inserted: number; updated: number; unchanged: number }>(`
    select count(*) filter (where p.pk is null) as inserted,
           count(*) filter (where p.pk is not null and p.source_record_hash <> c.source_record_hash) as updated,
           count(*) filter (where p.pk is not null and p.source_record_hash = c.source_record_hash) as unchanged
    from ${t} c left join prev_${t} p on p.pk = c.${pk}`);
  await db.exec(`update ${t} c set ingested_at = p.ingested_at, run_id = p.run_id
    from prev_${t} p where p.pk = c.${pk} and p.source_record_hash = c.source_record_hash`);
  return {
    inserted: Number(r?.inserted ?? 0),
    updated: Number(r?.updated ?? 0),
    unchanged: Number(r?.unchanged ?? 0),
  };
}

const prov = (
  system: string,
  url: string,
  runId: string,
  keyExpr = "source_record_key",
  hashExpr = "source_record_hash",
) =>
  `${q(system)} as source_system, ${keyExpr} as source_record_key, ${hashExpr} as source_record_hash,
   ${q(url)} || '?' || ${keyExpr} as source_url, now()::timestamp as ingested_at, ${q(runId)} as run_id`;

const asDate = (col: string) => `try_cast(substr(${col}, 1, 10) as date)`;
const usDate = (col: string) => `try_cast(try_strptime(${col}, '%m/%d/%Y') as date)`;
const pin14 = (col: string) => `lpad(regexp_replace(${col}, '[^0-9]', '', 'g'), 14, '0')`;

function saleSql(runId: string): string {
  const s = findSource("cook_sales");
  return `create or replace table sale as
    select 'cook_sales:' || source_record_key as sale_id, ${pin14("pin")} as pin14,
      ${asDate("sale_date")} as sale_date, try_cast(try_cast(sale_price as double) as bigint) as sale_price,
      deed_type, buyer_name, seller_name, doc_no,
      ${prov(s.system, sourceUrl(s), runId)}
    from raw_cook_sales where length(regexp_replace(pin, '[^0-9]', '', 'g')) = 14`;
}

function contractorSql(runId: string): string {
  const s = findSource("idfpr_roofing");
  return `create or replace table contractor as
    select 'idfpr:' || coalesce(license_number, 'row:' || source_record_key) as contractor_id,
      coalesce(nullif(trim(business_name), ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''), license_number) as name,
      ${SQL_NORMALIZE_NAME("coalesce(nullif(trim(business_name), ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''), license_number)")} as name_normalized,
      coalesce(license_number, '') as license_number, license_type, license_status, city, state, county,
      case ever_disciplined when 'Y' then true when 'N' then false else null end as ever_disciplined,
      null::varchar as bbb_rating, null::varchar as bbb_url, null::timestamp as bbb_checked_at, 'unknown' as bbb_state,
      nullif(trim(businessdba), '') as dba, ${usDate("expiration_date")} as expires_at,
      ${prov(s.system, sourceUrl(s), runId)}
    from raw_idfpr_roofing`;
}

/** name_key -> contractor_id per tier; one winner per key (ACTIVE first, latest expiry, lowest id). */
function contractorIndexSql(): string {
  return `create or replace temp table contractor_name_index as
    with cand as (
      select 1 as tier, name_normalized as name_key, contractor_id, license_status, expires_at from contractor
      union all
      select 2, ${SQL_STRIP_SUFFIXES("name_normalized")}, contractor_id, license_status, expires_at from contractor
      union all
      select 3, ${SQL_NORMALIZE_NAME("dba")}, contractor_id, license_status, expires_at from contractor where dba is not null
    )
    select tier, name_key, contractor_id from cand where name_key <> ''
    qualify row_number() over (partition by tier, name_key
      order by (license_status = 'ACTIVE') desc, expires_at desc nulls last, contractor_id) = 1`;
}

function businessSql(runId: string): string {
  const s = findSource("chicago_business_licenses");
  return `create or replace table business as
    select source_record_key as license_id, legal_name, doing_business_as_name as dba, address, city, zip_code as zip,
      try_cast(latitude as double) as lat, try_cast(longitude as double) as lon, null::varchar as geohash6,
      license_description, license_status as status, ${asDate("date_issued")} as issued_at, ${asDate("expiration_date")} as expires_at,
      ${prov(s.system, sourceUrl(s), runId)}
    from raw_chicago_business_licenses`;
}

function propertyBaseSql(runId: string, asOf: string): string {
  const s = findSource("cook_parcels");
  const d = `${q(asOf)}::date`;
  return `create or replace table property as
    with p as (select * from raw_cook_parcels qualify row_number() over (partition by pin order by year desc, updated_at desc nulls last) = 1),
      c as (select * from raw_cook_characteristics qualify row_number() over (partition by pin order by year desc, updated_at desc nulls last) = 1),
      a as (select * from raw_cook_addresses qualify row_number() over (partition by pin order by year desc, updated_at desc nulls last) = 1),
      s as (select * from sale qualify row_number() over (partition by pin14 order by sale_date desc nulls last, sale_price desc nulls last, sale_id) = 1)
    select ${pin14("p.pin")} as pin14, coalesce(p.pin10, substr(${pin14("p.pin")}, 1, 10)) as pin10,
      nullif(trim(a.prop_address_full), '') as address, nullif(trim(a.prop_address_city_name), '') as city,
      coalesce(nullif(a.prop_address_zipcode_1, ''), nullif(p.zip_code, '')) as zip,
      try_cast(p.lat as double) as lat, try_cast(p.lon as double) as lon, null::varchar as geohash6,
      try_cast(try_cast(c.char_yrblt as double) as integer) as year_built, p.class,
      p.cook_municipality_name as municipality, p.township_name as township,
      coalesce(nullif(trim(a.mail_address_name), ''), nullif(trim(a.owner_address_name), '')) as owner_name,
      nullif(trim(a.mail_address_full), '') as mail_address, nullif(trim(a.mail_address_city_name), '') as mail_city,
      nullif(trim(a.mail_address_state), '') as mail_state, nullif(trim(a.mail_address_zipcode_1), '') as mail_zip,
      case when a.mail_address_state is null or trim(a.mail_address_state) = '' then null
           else upper(trim(a.mail_address_state)) <> 'IL' or substr(a.mail_address_zipcode_1, 1, 3) not in (${inList(COOK_ZIP3)}) end as is_out_of_area,
      s.sale_date as last_sale_date, s.sale_price as last_sale_price,
      round(date_diff('day', s.sale_date, ${d}) / 365.25, 2) as years_since_sale,
      case when yb.y between 1800 and year(${d}) then (year(${d}) - yb.y)::double end as roof_age_years,
      case when yb.y between 1800 and year(${d}) then 'year_built' end as roof_age_basis,
      case when yb.y between 1800 and year(${d}) then 'low' end as roof_age_confidence,
      null::date as roof_age_anchor_date,
      ${prov(
        s.system,
        sourceUrl(s),
        runId,
        "p.source_record_key",
        "sha256(p.source_record_hash || coalesce(c.source_record_hash, '') || coalesce(a.source_record_hash, '') || coalesce(s.source_record_hash, ''))",
      )}
    from p left join c on c.pin = p.pin left join a on a.pin = p.pin left join s on s.pin14 = ${pin14("p.pin")},
      lateral (select try_cast(try_cast(c.char_yrblt as double) as integer) as y) yb
    where length(regexp_replace(p.pin, '[^0-9]', '', 'g')) = 14`;
}

function permitSql(runId: string, asOf: string): string[] {
  const cook = findSource("cook_assessor_permits");
  const chi = findSource("chicago_permits");
  const roofing = (col: string) =>
    `regexp_matches(${col}, ${q(ROOFING_INCLUDE)}, 'i') and not regexp_matches(${col}, ${q(ROOFING_EXCLUDE)}, 'i')`;
  const rule = (col: string) =>
    `case when regexp_matches(${col}, ${q(ROOFING_INCLUDE)}, 'i') then
       (case when regexp_matches(${col}, ${q(ROOFING_EXCLUDE)}, 'i') then ${q(`excluded:/${ROOFING_EXCLUDE}/i`)} else ${q(ROOFING_RULE)} end) end`;
  const chiContractor = Array.from({ length: 15 }, (_, i) => i + 1)
    .map(
      (n) =>
        `case when contact_${n}_type = 'CONTRACTOR-GENERAL CONTRACTOR' then nullif(trim(contact_${n}_name), '') end`,
    )
    .join(", ");
  const openCook = `status is not null and upper(trim(status)) not in (${inList(CLOSED_STATUSES["cook_assessor_permits"]!)})`;
  const openChi = `permit_status is not null and upper(trim(permit_status)) not in (${inList(CLOSED_STATUSES["chicago_permits"]!)})`;
  // first 10-digit pin in pin_list that is not the 0000000000 placeholder
  const chiPin10 = `nullif(regexp_extract(replace(coalesce(pin_list, ''), '0000000000', ''), '([0-9]{10})', 1), '')`;
  return [
    `create or replace temp table permit_base as
      select 'cook_assessor_permits:' || source_record_key as permit_id, 'cook_assessor_permits' as source_system,
        ${pin14("pin")} as pin14, null::varchar as pin10, nullif(trim(property_address), '') as address,
        null::double as lat, null::double as lon, job_code_primary as permit_type, work_description,
        status, ${openCook} as status_is_open,
        ${asDate("date_issued")} as issued_at, null::date as applied_at, null::date as closed_at,
        nullif(trim(applicant_name), '') as applicant_name, nullif(trim(applicant_name), '') as contractor_name,
        municipality, false as is_new_construction, source_record_key, source_record_hash, ${q(sourceUrl(cook))} as src_url
      from raw_cook_assessor_permits
      union all
      select 'chicago_permits:' || coalesce(nullif(permit_, ''), source_record_key), 'chicago_permits',
        null, ${chiPin10}, -- pin10 only when pin14 unknown, so the parcel fallback join is a pure equi-join
        nullif(trim(concat_ws(' ', street_number, street_direction, street_name)), ''),
        try_cast(latitude as double), try_cast(longitude as double), permit_type, work_description,
        permit_status, ${openChi},
        ${asDate("issue_date")}, ${asDate("application_start_date")}, null::date,
        nullif(trim(contact_1_name), ''), coalesce(${chiContractor}),
        'CITY OF CHICAGO', permit_type = 'PERMIT - NEW CONSTRUCTION', source_record_key, source_record_hash, ${q(sourceUrl(chi))}
      from raw_chicago_permits
      qualify row_number() over (partition by coalesce(nullif(permit_, ''), source_record_key) order by updated_at desc nulls last) = 1`,
    `alter table permit_base add column name_key1 varchar`,
    `alter table permit_base add column name_key2 varchar`,
    `update permit_base set name_key1 = ${SQL_NORMALIZE_NAME("contractor_name")} where contractor_name is not null`,
    `update permit_base set name_key2 = ${SQL_STRIP_SUFFIXES("name_key1")} where name_key1 is not null`,
    `create or replace temp table prop_geo as select pin14, pin10, lat, lon from property where lat is not null`,
    `create or replace temp table prop_geo10 as select pin10, min(pin14) as pin14, avg(lat) as lat, avg(lon) as lon from prop_geo group by pin10`,
    `create or replace table permit as
    select b.permit_id, b.source_system, coalesce(b.pin14, pp.pin14, p10.pin14) as pin14, b.address,
      coalesce(b.lat, pp.lat, p10.lat) as lat, coalesce(b.lon, pp.lon, p10.lon) as lon, null::varchar as geohash6,
      b.permit_type, b.work_description, ${roofing("coalesce(b.work_description, '')")} as is_roofing, ${rule("coalesce(b.work_description, '')")} as roofing_match_rule,
      b.status, b.status_is_open, b.issued_at, b.applied_at, b.closed_at,
      case when b.status_is_open then date_diff('day', coalesce(b.issued_at, b.applied_at), ${q(asOf)}::date) end as open_days,
      b.applicant_name, b.contractor_name,
      coalesce(i1.contractor_id, i2.contractor_id, i3.contractor_id) as contractor_id,
      case when i1.contractor_id is not null then 'exact_normalized' when i2.contractor_id is not null then 'suffix_stripped' when i3.contractor_id is not null then 'dba' end as contractor_match_tier,
      b.municipality, b.is_new_construction,
      b.source_system as source_system, b.source_record_key, b.source_record_hash, b.src_url || '?' || b.source_record_key as source_url,
      now()::timestamp as ingested_at, ${q(runId)} as run_id
    from permit_base b
    left join prop_geo pp on pp.pin14 = b.pin14
    left join prop_geo10 p10 on p10.pin10 = b.pin10
    left join contractor_name_index i1 on i1.tier = 1 and i1.name_key = b.name_key1
    left join contractor_name_index i2 on i2.tier = 2 and i2.name_key = b.name_key2
    left join contractor_name_index i3 on i3.tier = 3 and i3.name_key = b.name_key1`,
    `drop table permit_base`,
    `drop table prop_geo`,
    `drop table prop_geo10`,
  ];
}

/** Mirrors estimateRoofAge(): latest completed reroof -> high; completed new construction -> medium; year built -> low. */
function roofAgeSql(asOf: string): string {
  const d = `${q(asOf)}::date`;
  return `update property pr set
      roof_age_years = coalesce(a.reroof_years, a.build_years, case when pr.year_built between 1800 and year(${d}) then year(${d}) - pr.year_built end),
      roof_age_basis = case when a.reroof_years is not null then 'reroof_permit' when a.build_years is not null then 'new_construction_permit'
                            when pr.year_built between 1800 and year(${d}) then 'year_built' end,
      roof_age_confidence = case when a.reroof_years is not null then 'high' when a.build_years is not null then 'medium'
                                 when pr.year_built between 1800 and year(${d}) then 'low' end,
      roof_age_anchor_date = coalesce(a.reroof_date, a.build_date)
    from (
      select pin14,
        max(case when is_roofing then coalesce(closed_at, issued_at) end) as reroof_date,
        max(case when is_new_construction then coalesce(closed_at, issued_at) end) as build_date,
        date_diff('year', max(case when is_roofing then coalesce(closed_at, issued_at) end), ${d}) as reroof_years,
        date_diff('year', max(case when is_new_construction then coalesce(closed_at, issued_at) end), ${d}) as build_years
      from permit
      where not status_is_open and pin14 is not null and coalesce(closed_at, issued_at) is not null and coalesce(closed_at, issued_at) <= ${d}
        and (is_roofing or is_new_construction)
      group by pin14
    ) a where a.pin14 = pr.pin14`;
}

/** geohash6 as a vectorised SQL macro (15 lon bits + 15 lat bits interleaved, base32). Mirrors shared/geo.ts. */
export const GEOHASH_MACROS = `
  create or replace macro gh_bit(latv, lonv, i) as
    case when i % 2 = 0 then (lonv >> (14 - i // 2)) & 1 else (latv >> (14 - (i - 1) // 2)) & 1 end;
  create or replace macro gh_chunk(latv, lonv, k) as
    gh_bit(latv, lonv, 5 * k) * 16 + gh_bit(latv, lonv, 5 * k + 1) * 8 + gh_bit(latv, lonv, 5 * k + 2) * 4
    + gh_bit(latv, lonv, 5 * k + 3) * 2 + gh_bit(latv, lonv, 5 * k + 4);
  create or replace macro geohash6(lat, lon) as
    case when lat is null or lon is null or lat < -90 or lat > 90 or lon < -180 or lon > 180 then null else
    array_to_string(list_transform(range(0, 6), k -> substr('0123456789bcdefghjkmnpqrstuvwxyz',
      1 + gh_chunk(least(floor((lat + 90) / 180 * 32768)::bigint, 32767), least(floor((lon + 180) / 360 * 32768)::bigint, 32767), k), 1)), '') end;`;

async function fillGeohash(db: Duck, log: Logger): Promise<void> {
  const t0 = Date.now();
  for (const stmt of GEOHASH_MACROS.split(";")
    .map((x) => x.trim())
    .filter(Boolean))
    await db.exec(stmt);
  for (const t of ["property", "permit", "business"]) {
    await db.exec(`update ${t} set geohash6 = geohash6(lat, lon)`);
  }
  log.info({ step: "geohash", ms: Date.now() - t0 }, "transform step");
}

async function exportParquet(
  db: Duck,
  dataDir: string,
  runId: string,
  log: Logger,
): Promise<string> {
  const dir = join(dataDir, "dataset", runId);
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (const t of ["property", "permit", "contractor", "business", "sale", "source_watermark"]) {
    await db.exec(`copy (select * from ${t}) to ${q(join(dir, t))}
      (format parquet, compression zstd, file_size_bytes '64MB', overwrite_or_ignore true)`);
  }
  log.info({ step: "parquet", dir, ms: Date.now() - t0 }, "transform step");
  return dir;
}
