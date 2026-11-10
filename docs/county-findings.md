# Cook County, IL — county findings

Profile written 2026-11-10 following the kit `county-discovery` skill sections, adapted to a
county whose data is published through open-data portals rather than scraped portals.

## 1. Overview

- County: Cook, Illinois (FIPS 17031), ~1.86M parcels, 134 municipalities plus unincorporated
  areas served by the county; the City of Chicago is ~45% of parcels.
- Assessor (appraiser) data is published on the Cook County Open Data portal (Socrata,
  `datacatalog.cookcountyil.gov`) as bulk datasets with a stable `:id`-ordered API; no
  per-parcel portal scraping is required.
- Parcel identifier: 14-digit PIN (`AA-BB-CCC-DDD-EEEE`), `pin10` = first 10 digits
  (land parcel), last 4 = unit. Chicago permits carry 10-digit PINs only.

## 2. Sources inventory

See `docs/sources.md` for dataset ids, counts, fields and speed. Summary:

| Need | Source | Mode |
|---|---|---|
| Parcels + coordinates | Assessor Parcel Universe (Current Year) `pabr-t5kh` | bulk API |
| Year built / roof construction | Residential Characteristics `x54s-btds` (year=2026) | bulk API |
| Situs + mailing/owner name | Parcel Addresses `3723-97qp` (year=2026) | bulk API |
| Sales / ownership change | Parcel Sales `wvhk-k5uv` | bulk API |
| Permits (countywide) | Assessor Permits `6yjf-dfxs` | bulk API |
| Permits (Chicago, with contractors) | Chicago Building Permits `ydr8-5enu` | bulk API |
| Business records | Chicago Business Licenses `r5kz-chrr` | bulk API |
| Roofing contractors | IDFPR licenses `pzzh-kp68` | bulk API |
| Deeds / mortgages / liens | Cook County Clerk Recordings | portal only, no bulk — not loaded |
| Tax payments | Cook County Treasurer | portal only — not loaded |
| Chicago trade licenses | chicago.gov HTML search | not bulk — not loaded |
| BBB ratings | bbb.org | not harvested yet |

## 3. Permit jurisdictions

- Chicago: one open-data feed with 15 contact slots per permit (general contractor name is
  available for 86k permits as `contact_1_type = CONTRACTOR-GENERAL CONTRACTOR`, more in other
  slots). No close date; `permit_status` COMPLETE/EXPIRED/CANCELLED/REVOKED is terminal.
- Suburban Cook (≈130 municipalities, unincorporated handled by the county Building & Zoning
  department): each municipality runs its own permit system (Accela, Tyler, BS&A, CityView,
  paper). None of these is bulk-exportable; the Assessor Permits feed is the countywide
  proxy: it receives a copy of every permit for assessment purposes with `status`
  (CLOSED/PENDING/OPEN/RECHECK/MANAGER REVIEW), `date_issued`, `applicant_name`,
  `work_description` and `municipality`, but no contractor license and no close date.
- Readiness classification for `runtime/cook-sources.yaml`: Chicago `supported`; every
  suburban jurisdiction `delegated` to the Assessor feed with `historical_records: true`
  for assessment permits; the per-municipality portals remain `needs-review` and are
  listed as a known gap (not enumerated one by one in this pass).

## 4. Contractor licensing authority

- Illinois licenses roofing contractors at state level: IDFPR "Roofing Contractor"
  licenses (`104xxxxxx`), 34,116 rows statewide, 17,311 ACTIVE; `ever_disciplined` flag.
- Chicago additionally requires a City General Contractor license (HTML search only).
- Matching: permit contractor/applicant name → IDFPR business name (exact normalized →
  suffix-stripped → DBA). No license number is printed on either permit feed, so matches
  are name-based and recorded with their tier (`permit.contractor_match_tier`).

## 5. BBB stance

- BBB Chicago & Northern Illinois lists roofing contractors; listing pages cap at ~24 per
  page and the advertised category total is not a harvestable count. Not harvested in this
  milestone: every contractor row carries `bbb_state = 'unknown'`, `bbb_rating = null`.
  The `bbb-harvest` skill flow (search by normalized name + city, record
  `confirmed_present/confirmed_empty/unavailable`) is the planned next step.

## 6. Geo / coordinates

- Parcel centroids (`lat`, `lon`) come from the Parcel Universe for 1,861,471 of 1,864,469
  parcels (99.8%). Chicago permits carry their own geocode (98.5%); Assessor permits have
  none and are geocoded by PIN to the parcel centroid; Chicago permits without coordinates
  fall back to the parcel(s) in `pin_list` (10-digit, averaged).
- `geohash6` (~1.2 km × 0.6 km cells) is stored on property, permit and business for
  radius prefilters; haversine refines.

## 7. Constraints and speed

- Socrata: 50,000 rows per page, ~1.1 MB/s per connection, 4 in flight per host. Filtered
  historical datasets (`year=2026` on `x54s-btds` / `3723-97qp`) cost 4–60 s per page;
  unfiltered current-year extracts ~2–15 s. Full load ≈ 10.4M rows in well under an hour.
- Cook County republishes assessor datasets monthly as whole tables; `:updated_at` moves
  for every row, so incremental on those sources means a monthly re-download.
- No bot challenges, no CAPTCHA, no geo-blocking observed; app-token auth lifts the
  anonymous throttle.

## 8. Open questions

- Permit close dates: neither feed has them; `open_days` for closed permits is null.
- Should the 303k status-less pre-2006 Chicago permits be treated as closed for roof-age
  anchoring? Currently they are never "open" but also not used as anchors unless
  status is terminal (they are not), so they do not reset roof age.
- Suburban permit portals: enumerate and classify each of the ~130 municipalities before
  any runtime-retrieval adapter (not done; see `runtime/cook-sources.yaml`).
- Destination for IPFS/Elephant publication and the BBB harvest are the next milestones.

## Readiness validator result

`python3 -I <kit>/skills/use-oracle/scripts/validate-county-readiness.py runtime/cook-sources.yaml`
→ `overall: PASS` (catalog_metadata PASS, parcel PASS at 0.16% centroid gap, permit PASS 3/3,
destination NOT_APPLICABLE because `writes_in_scope: false`, enrichment PASS).

Caveat, stated so the pass is not over-read: the permit gate passes because the ~130 suburban
municipalities are catalogued as one grouped `delegated` row backed by the Assessor permit
feed, not enumerated and probed individually as the kit's fragmented-jurisdiction procedure
asks. A per-municipality enumeration would turn that row into ~130 `needs-review` rows and the
gate would be BLOCKED until each is classified. The destination gate is not exercised at all.
