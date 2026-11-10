# Cook County, IL — data sources

All sources are Socrata open-data endpoints. Every request carries HTTP basic auth
(`SOCRATA_KEY_ID:SOCRATA_KEY_SECRET`, loaded from `.env` by the CLI only). Paging uses
`$select=:id,:updated_at,<fields>&$order=:id&$limit=50000&$offset=N`; the pipeline keeps
4 concurrent requests per host and backs off exponentially (with jitter) on 429/5xx.

Counts and timings below were measured on 2026-11-10 with `pipeline discover` and a
1,000-row sample fetch per source (`pipeline fetch --sample 1000 --data data/sample`).

| source_system | Dataset | Host | Filter | Total rows | max(:updated_at) | Feeds |
|---|---|---|---|---:|---|---|
| cook_parcels | [pabr-t5kh](https://datacatalog.cookcountyil.gov/d/pabr-t5kh) Assessor Parcel Universe (Current Year) | datacatalog.cookcountyil.gov | none | 1,864,469 | 2026-11-01 | property (coords, class, municipality, township) |
| cook_characteristics | [x54s-btds](https://datacatalog.cookcountyil.gov/d/x54s-btds) Single & Multi-Family Improvement Characteristics | datacatalog.cookcountyil.gov | `year=2026` | 1,102,912 | 2026-11-01 | property (year_built, roof construction) |
| cook_addresses | [3723-97qp](https://datacatalog.cookcountyil.gov/d/3723-97qp) Parcel Addresses | datacatalog.cookcountyil.gov | `year=2026` | 1,864,469 | 2026-11-01 | property (situs address, owner/mailing) |
| cook_sales | [wvhk-k5uv](https://datacatalog.cookcountyil.gov/d/wvhk-k5uv) Parcel Sales | datacatalog.cookcountyil.gov | none | 2,688,811 | 2026-11-01 | sale, property.last_sale_* |
| cook_assessor_permits | [6yjf-dfxs](https://datacatalog.cookcountyil.gov/d/6yjf-dfxs) Assessor Permits | datacatalog.cookcountyil.gov | none | 754,772 | 2026-11-01 | permit (countywide incl. suburbs) |
| chicago_permits | [ydr8-5enu](https://data.cityofchicago.org/d/ydr8-5enu) Building Permits | data.cityofchicago.org | none | 852,615 | 2026-11-09 | permit (City of Chicago) |
| chicago_business_licenses | [r5kz-chrr](https://data.cityofchicago.org/d/r5kz-chrr) Business Licenses | data.cityofchicago.org | none | 1,211,181 | 2026-11-07 | business |
| idfpr_roofing | [pzzh-kp68](https://data.illinois.gov/d/pzzh-kp68) IDFPR Professional Licenses | data.illinois.gov | `license_type='ROOFING CONTRACTOR'` | 34,116 (5,353 in Cook) | 2026-11-09 | contractor |

`nj4t-kc8j` (Parcel Universe historical, `year=2026`) was the first choice for parcels; a filtered,
`:id`-ordered page took 7–60 s, so the pipeline uses the unfiltered current-year extract
`pabr-t5kh` (identical 1,864,469 rows, 1,861,471 with lat/lon).

## Fields used

- cook_parcels: `pin, pin10, year, class, township_name, cook_municipality_name, zip_code, lat, lon`
- cook_characteristics: `pin, year, class, char_yrblt, char_roof_cnst` (duplicate `pin|year` keys exist for multi-building parcels; the latest `:updated_at` wins)
- cook_addresses: `pin, pin10, year, prop_address_full, prop_address_city_name, prop_address_zipcode_1, mail_address_name, mail_address_full, mail_address_city_name, mail_address_state, mail_address_zipcode_1, owner_address_name`
- cook_sales: `pin, year, sale_date, sale_price, doc_no, deed_type, buyer_name, seller_name, is_multisale, num_parcels_sale, row_id`
- cook_assessor_permits: all 22 columns (`date_issued, status, applicant_name, work_description, municipality, ...`); statuses: CLOSED 710,004 / PENDING 34,227 / RECHECK 4,027 / OPEN 3,146 / MANAGER REVIEW 1,829 / null 1,539. No close date column.
- chicago_permits: `id, permit_, permit_status, permit_milestone, permit_type, application_start_date, issue_date, street_number, street_direction, street_name, work_description, pin_list, latitude, longitude, contact_1..15_type/name`; statuses: COMPLETE 486,877 / ACTIVE 31,077 / EXPIRED 16,827 / SUSPENDED 13,136 / PHASED PERMITTING 976 / CANCELLED 401 / REVOKED 292 / null 303,029. `pin_list` holds 10-digit PINs separated by ` | ` (466,313 rows have none; 13,122 lack lat/lon).
- chicago_business_licenses: `id, license_id, legal_name, doing_business_as_name, address, city, state, zip_code, license_description, license_status, date_issued, license_start_date, expiration_date, latitude, longitude`
- idfpr_roofing: `license_number, license_status, business_name, businessdba, first_name, last_name, city, state, county, ever_disciplined, expiration_date, ...`; 8 of the first 1,000 rows have an empty license number (keyed by Socrata `:id`).

## Record keys and change detection

`source_record_key` = `pin|year` (parcels, characteristics, addresses), `row_id` (sales, assessor permits),
`id` (Chicago permits, business licenses), `license_number` (IDFPR), falling back to Socrata `:id`.
`source_record_hash` = SHA-256 of the canonical JSON of the selected source fields (system fields
excluded). Every dataset exposes `:updated_at`, which is the incremental watermark for all sources.

## Roofing regex hit rate (sample of 1,000 rows each)

Rule: `work_description ~ /\bRE-?ROOF|\bROOF(ING)?\b|SHINGLE|TEAR[- ]?OFF/i and not /ROOF ?DECK|ROOFTOP|GREEN ROOF|SOLAR/i`

| Source | Roofing hits / 1,000 | Full-dataset `LIKE '%ROOF%'` |
|---|---:|---:|
| cook_assessor_permits | 178 (17.8%) | 136,871 / 754,772 (18.1%) |
| chicago_permits | 85 (8.5%) | 70,830 / 852,615 (8.3%) |

## Observed speed

| Source | 1,000-row sample | 50,000-row page | Notes |
|---|---:|---:|---|
| cook_parcels (pabr-t5kh) | 3.1 s | ~12 s | unfiltered |
| cook_characteristics | 51.0 s (cold) | 45 s first page, then 3.5–9.5 s | `year=2026` filter + `:id` sort is slow until the server caches |
| cook_addresses | 12.7 s | ~15 s | filtered |
| cook_sales | 1.6 s | ~1.7 s/page (54 pages in 92 s with 4 in flight) | |
| cook_assessor_permits | 4.4 s | ~16 s (18.5 MB CSV) | |
| chicago_permits | 1.8 s | ~10 s | wide rows (contacts) |
| chicago_business_licenses | 1.9 s | ~8 s | |
| idfpr_roofing | 2.7 s | single page, 4.8 s | |

`count(*)` with `max(:updated_at)` takes 0.4–14 s per source. Throughput is ~1.1 MB/s per
connection (gzip on the wire); the full fetch of ~10.4M rows is bounded by the Cook County
host (four datasets share its 4-slot limit).

## Limitations

- No close/completion date on either permit feed; terminal status is the only closure signal, `closed_at` stays null.
- Chicago permits before 2006 (303k) have no status and are never counted as open.
- Suburban municipal permit portals are not bulk-available; the Assessor permit feed is the only countywide permit source and it carries no contractor identity beyond `applicant_name`.
- Cook County Clerk recordings, Treasurer payments and Chicago trade licenses (HTML search only) are not loaded.
- BBB ratings are not harvested (`bbb_state = 'unknown'`).
