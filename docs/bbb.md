# BBB reputation harvest

`pipeline bbb --limit N --min-permits M` (`apps/pipeline/src/enrich/bbb.ts`) adds Better Business Bureau
ratings to `contractor` as **reputation only**. Contractor identity stays the IDFPR roofing roster; a BBB
profile never creates or changes a `contractor_id` (team kit, `bbb-harvest` and the permit-evidence preflight).

## Method

1. Candidates: contractors ordered by ACTIVE license first, then by number of `property_improvement_has_contractor`
   links (desc), at least `--min-permits` links, at most `--limit`; contractors checked within the last 30 days
   are skipped (`bbb_lookup.bbb_checked_at`).
2. `https://www.bbb.org/robots.txt` is the **first** request. Its rules are parsed (longest match wins) and
   every later bbb.org path is checked against them. `/*?` is disallowed, so the search page is never used:
   no bbb.org URL with a query string is ever requested.
3. Profile URLs are found without search through the Internet Archive CDX index
   (`web.archive.org/cdx/search/cdx?url=bbb.org/us/il/*&filter=original:.*roofing-contractors.*&filter=statuscode:200&collapse=urlkey&output=json&limit=5000`):
   878 archived Illinois `roofing-contractors` profile URLs (2026-11-10). The slug (`davis-roofing-construction-0654-88376154`
   → `davis roofing construction`) is matched to the licensed name and DBA with the same normalization as the
   permit match (`packages/shared/src/names.ts`), with and without legal suffixes, with and without `and`
   (BBB slugs drop `&`). Only a unique match is used; two candidate profiles → `ambiguous_name_slug`.
4. If bbb.org is not blocked and robots allows the path, the live profile is fetched → `confirmed_present`
   (rating found) or `confirmed_empty`, `bbb_source='live'`. The first HTTP 403 or 429 from bbb.org ends every
   further bbb.org request for the run (`blocks` in the summary). No proxies, no retries on 403/429, no
   fingerprint or challenge handling.
5. When the live page cannot be read, the latest archived capture (`web.archive.org/web/<ts>id_/<url>`) is
   parsed instead and stored as `bbb_state='stale'`, `bbb_source='archive'`, `bbb_reason='access_boundary_403'`,
   with the capture timestamp in `bbb_lookup.bbb_archive_timestamp`. `bbb_url` is always the live profile URL.
6. Pacing: one request at a time, 3 s before every request to either host, User-Agent
   `cook-il-property-intelligence/0.1 (open-data roofing research; one request per 3 s; stops on 403)`.
   5xx / network errors retry 3 times with doubling delay; after that no row is written, so the next run
   retries (`transient_failures` in the summary). A CDX outage aborts the run without writing anything.
7. Parsing: `BBB Rating <A+ … F | NR>` and `is / NOT BBB Accredited` from the page text, falling back to the
   embedded `"rating"` / `"accredited"` JSON (`parseProfile`, tests in `bbb.test.ts`, spot-checked against two
   archived profiles including a not-accredited A+).
8. Persistence: `bbb_lookup(contractor_id PK, bbb_state, bbb_rating, bbb_accredited, bbb_url, bbb_checked_at,
bbb_reason, bbb_source, bbb_archive_timestamp)` is the idempotent staging table; the run updates `contractor`
   in place and every later `transform` joins `bbb_lookup` again, so harvests survive rebuilds and are in the
   Parquet snapshot of the next run.

## robots / ToS stance

bbb.org answers every request from this host — including `robots.txt` — with HTTP 403 (Cloudflare
"Just a moment" challenge). Per the kit this is a source-access boundary: the harvest records it and sends no
further bbb.org request. The compliant route to live data is approved access through
`https://developer.bbb.org/`; until then only archived copies are read, and they are labelled `stale`, never
`confirmed_present`. Archived pages are public captures served by the Internet Archive; the harvest uses its
documented CDX API and plain `id_` captures at the same 3 s pacing.

## Run of 2026-11-10 (`--limit 150`, real database)

| Item                                         | Value                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Candidates (ACTIVE first, most permit links) | 150, covering 26,057 of 58,902 permit→contractor links                                        |
| bbb.org requests                             | 1 (`robots.txt` → 403 at 22:15:08Z, harvest stopped)                                          |
| Internet Archive requests                    | 22 (1 CDX index + 21 captures), 0 transient failures                                          |
| Profiles found (unique slug match)           | 21 → `bbb_state='stale'`, `bbb_source='archive'`, captures 2018-12-31 … 2026-06-13            |
| Ratings                                      | A+: 21 (20 accredited, 1 not accredited)                                                      |
| `unavailable`                                | 129 = 127 `access_boundary_403` (no archived profile, live blocked) + 2 `ambiguous_name_slug` |
| Not attempted                                | 33,410 contractors stay `unknown`                                                             |
| Elapsed                                      | 116 s                                                                                         |

Rerunning within 30 days: 0 candidates, 0 requests. The run summary (`run.counts`, `/` page) reports the
contractor count; `contractors_with_bbb` on the web counts non-null `bbb_rating` (21).

## Limitations

- Live BBB data is unreachable (403 at `robots.txt`); every rating is an archived snapshot with its capture
  date and can be years old. The 21 found profiles skew to accredited businesses because those are what the
  Archive captured — this is not a rating distribution of Cook County roofers.
- Only profiles the Internet Archive captured under `/us/il/*/profile/roofing-contractors/` are discoverable;
  contractors filed under other BBB categories (general contractors, siding, solar) are not found.
- Name-slug matching is reputation-profile matching only (kit tier 3); no license-number or phone tier exists
  because IDFPR license numbers and phones do not appear in BBB slugs. Ambiguous slugs are skipped, not guessed.
- The `confirmed_present` / `confirmed_empty` paths are implemented and unit-tested but have never executed
  against bbb.org from this host.
