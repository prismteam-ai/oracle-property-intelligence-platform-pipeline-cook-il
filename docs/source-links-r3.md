# R3 source citation repair

## Boundary and provenance

The old transform appended `?source_record_key` to a dataset endpoint. Socrata interprets
that as an unknown argument, not a row selector. `sourceRecordUrlSql` now uses the source
registry's actual key fields and percent-encodes each value. The existing registry moved
unchanged into `@cook/shared`; pipeline imports remain compatible through a re-export.

New transforms produce valid URLs for property, permit, sale, business and contractor
rows, including copied contractor-license edges. Missing natural keys use an escaped
`$where=:id='…'` filter: a plain `:id=…` query parameter also returns HTTP 400.

Serving creates connection-local views over read-only DuckDB tables or verified Parquet
files. Only exact legacy `dataset-endpoint?source_record_key` URLs for known sources are
repaired. SQL projections/aliases, MCP tools, property searches and nested permits and
contractors therefore receive usable `source_url` values. `source_url_original` exposes
the stored URL, including through typed property/permit/contractor responses.

Published Parquet bytes, hashes, manifests, CIDs, run IDs and ingestion timestamps remain
unchanged. This is a serving projection, not a dataset republish. Direct artifact downloads
still contain the original URLs. Production needs the serving-code deployment to apply
this projection; no deployment or score improvement is claimed here.

## Supported mappings

All field names below were checked against public `/api/views/<dataset>.json` metadata
(HTTP 200 for all eight datasets) on 2026-11-11.

| source_system               | Dataset     | Record filter           |
| --------------------------- | ----------- | ----------------------- |
| `cook_parcels`              | `pabr-t5kh` | `pin`, `year`           |
| `cook_characteristics`      | `x54s-btds` | `pin`, `year`           |
| `cook_addresses`            | `3723-97qp` | `pin`, `year`           |
| `cook_sales`                | `wvhk-k5uv` | `row_id`                |
| `cook_assessor_permits`     | `6yjf-dfxs` | `row_id`                |
| `chicago_permits`           | `ydr8-5enu` | `id` (not `permit_`)    |
| `chicago_business_licenses` | `r5kz-chrr` | `id` (not `license_id`) |
| `idfpr_roofing`             | `pzzh-kp68` | `license_number`        |

Unknown sources, custom endpoints, already-valid URLs, incomplete composite keys and
ambiguous legacy `row-…` keys are preserved. Legacy snapshots lack the raw fields needed
to prove whether a fallback key is a Socrata row ID; the repair does not guess. New
transforms can distinguish that fallback using the raw key fields. Characteristics may
have multiple buildings for one PIN/year, matching the existing ingestion key contract.
Live source records may change or disappear independently of the archived evidence.

## Public read-only verification — 2026-11-11

No credentials were used. Each corrected representative URL returned exactly one row;
the row identifiers below were checked, not just HTTP status.

| Request                                                                                              | HTTP | Verified result                                                     |
| ---------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| `https://datacatalog.cookcountyil.gov/resource/pabr-t5kh?10253260360000\|2026`                       | 400  | `Unrecognized arguments [10253260360000\|2026]`                     |
| `https://datacatalog.cookcountyil.gov/resource/pabr-t5kh?11304030030000\|2026`                       | 400  | `Unrecognized arguments [11304030030000\|2026]`                     |
| `https://data.cityofchicago.org/resource/ydr8-5enu?3143020`                                          | 400  | `Unrecognized arguments [3143020]`                                  |
| `https://data.cityofchicago.org/resource/ydr8-5enu?3159018`                                          | 400  | `Unrecognized arguments [3159018]`                                  |
| `https://datacatalog.cookcountyil.gov/resource/pabr-t5kh.json?pin=10253260360000&year=2026`          | 200  | PIN `10253260360000`, year `2026`, row ID `102532603600002026`      |
| `https://datacatalog.cookcountyil.gov/resource/pabr-t5kh.json?pin=11304030030000&year=2026`          | 200  | PIN `11304030030000`, year `2026`, row ID `113040300300002026`      |
| `https://data.cityofchicago.org/resource/ydr8-5enu.json?id=3143020`                                  | 200  | ID `3143020`, permit `100890214`, PIN list `1025326036`, JARLATH ST |
| `https://data.cityofchicago.org/resource/ydr8-5enu.json?id=3159018`                                  | 200  | ID `3159018`, permit `100902014`, PIN list `1130403003`, CLARK ST   |
| `https://data.cityofchicago.org/resource/ydr8-5enu.json?%3Aid=row-bpqu%7Efekh-f98g`                  | 400  | `Unrecognized arguments [:id]`                                      |
| `https://data.cityofchicago.org/resource/ydr8-5enu.json?%24where=%3Aid%3D%27row-bpqu%7Efekh-f98g%27` | 200  | ID `3143020`, permit `100890214`, exactly one row                   |

## Regression coverage

- Actual transform output for all five contract tables, Chicago ID vs permit number,
  Socrata fallback, and copied license-edge URL.
- All eight source mappings, composite keys, URL encoding (including Unicode, quotes,
  ampersands and query/fragment delimiters), and escaped fallback predicates.
- Legacy read-only projections, unknown/custom/correct-URL passthrough, ambiguous keys,
  license edges, and typed nested property/permit provenance.
- Published-snapshot serving with unchanged file bytes, manifest and integrity verification.

Live checks are recorded evidence, not network-dependent unit tests. BBB was not probed.

## Local checks

- `pnpm install --offline --frozen-lockfile`: independent worktree dependencies installed.
- `pnpm build` and final `pnpm exec turbo run build typecheck`: passed; existing Vite
  large-chunk advisory remains.
- `pnpm typecheck`: passed.
- `pnpm lint`: ESLint and repository-wide Prettier check passed.
- `pnpm test`: 139 tests passed across 29 files, including Turbo-cached unaffected suites
  (pipeline 34, web 59, shared 31, agent-handler 5, DuckDB 4, IPFS 5, CDK 1).
- Focused source/transform/Socrata tests: 15 passed. Focused serving/snapshot/property
  tests: 16 passed. `git diff --check`: passed.
