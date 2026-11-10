# Pipeline — how it runs

`apps/pipeline` is a CLI (`pipeline <discover|fetch|stage|transform|run|serve|prune>`) that moves
Cook County open data from Socrata into `data/cook_il.duckdb` and Parquet snapshots under
`data/dataset/<run_id>/<table>/`. Everything is file-based: no database server, no queue.

## Local

```bash
corepack enable && pnpm install
cp .env.example .env            # fill SOCRATA_KEY_ID / SOCRATA_KEY_SECRET
pnpm build
node apps/pipeline/dist/cli.js discover                 # counts + max(:updated_at) per source
node apps/pipeline/dist/cli.js fetch --sample 1000 --data data/sample   # quick smoke batch
node apps/pipeline/dist/cli.js run                      # full: fetch + stage + transform
node apps/pipeline/dist/cli.js run --incremental        # delta since each source watermark
node apps/pipeline/dist/cli.js transform --as-of 2026-11-10   # rebuild contract tables only
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Options: `--source <system>` (repeatable), `--data <dir>` (default `$DATA_DIR` or `./data`),
`--as-of <date>` for roof-age / open-days arithmetic. Logs are JSON (pino) on stdout with
`run_id`, `source`, `step` and `ms` per step; a long fetch is best run as
`nohup node apps/pipeline/dist/cli.js fetch > data/logs/fetch-full.log 2>&1 &`.

## Docker

```bash
docker compose build            # multi-stage node:22-slim, pnpm workspace build
docker compose up -d            # web (port 8080, /health, /build.json) + pipeline loop
docker compose run --rm pipeline node apps/pipeline/dist/cli.js run   # one-off full run
```

The `pipeline` service loops `run --incremental` every 6 h; both services share `./data`
as a volume and read `.env` via `env_file`. The `web` command is a placeholder until
`apps/web` lands (it serves `/health` and `/build.json` from the pipeline CLI).

## Steps

1. **fetch** — per source: `count(*)` with the source filter, then pages of 50,000 rows
   ordered by `:id`, 4 in flight per host, exponential backoff with jitter on 429/5xx
   (`Retry-After` honoured). Each page is written atomically to
   `data/raw/<source>/<batch>/page-NNNNN.ndjson` (one JSON object per row, all values as
   strings, plus `_key`, `_hash`, `_id`, `_updated_at`). A `_done.json` marker closes the batch.
   Re-running skips existing pages and completed batches, so an interrupted fetch resumes.
   Failed pages (after 6 retries) go to `_dead.ndjson` and the run's dead-letter list; the
   batch stays open and the next run retries only those pages.
2. **stage** — every completed batch that is not yet in `staged_batch` is upserted into
   `raw_<source>` (`insert or replace` on `source_record_key`, latest `_updated_at` wins,
   empty strings become NULL). The source watermark (`max(updated_at)`) is stored in
   `source_watermark`.
3. **transform** — rebuilds the contract tables from the raw tables deterministically
   (`sale`, `contractor`, `business`, `property`, `permit`, then roof age, geohash and the two
   relationship tables below),
   computes deltas by hash against the previous version of each table, writes Parquet
   (`zstd`, files ≤ 64 MB) and keeps `cook_il.duckdb` current.
4. **run** = fetch + stage + transform under one `run_id` row in `run`.
5. **bbb** (`pipeline bbb --limit N --min-permits M`) — separate, rate-limited BBB reputation
   harvest into the `bbb_lookup` staging table; transform joins it into `contractor`. See `docs/bbb.md`.

## Contractor identity (kit vocabulary)

The IDFPR roofing roster is the only contractor identity. Permit names are search keys, never
identities: `permit.contractor_id` / `permit.contractor_match_tier` stay as convenience columns, and
the same match is published as relationship tables:

- `property_improvement_has_contractor(permit_id, contractor_id, match_tier, match_confidence, matched_name_key, run_id)`
  — one row per permit that resolved to a roster company. `match_confidence` follows the kit tiers:
  `exact_normalized` 0.80, `suffix_stripped` 0.70, `dba` 0.70. There is no license-number (1.0) or
  phone (0.95) tier because Cook Assessor and Chicago permits publish neither.
- `contractor_has_license(contractor_id, license_number, license_type, license_status, authority='IDFPR', source_url, run_id)`
  — one row per roster company with a license number.

Both are rebuilt every transform, exported to Parquet, counted in `run.counts` and served by the
web/MCP snapshot.

## Batches, watermarks, incremental mode

- Batch ids: `full` (initial load), `sample` (smoke), `inc-<run_id>` (delta).
- `run --incremental` reads `source_watermark.watermark_value` per source and fetches
  `:updated_at > <watermark> AND :updated_at <= <run start>` into `inc-<run_id>`. A source
  without a watermark falls back to its `full` batch (which is skipped when already complete).
- Every Socrata dataset exposes `:updated_at`; it is the watermark field everywhere.
- Cook County republishes its Assessor datasets monthly (whole-table refresh, every
  `:updated_at` moves), so a monthly incremental run on those sources is effectively a
  full re-download; Chicago and IDFPR feeds change row by row.

## Idempotency

- Fetch: page files and `_done.json` make re-runs no-ops.
- Stage: `staged_batch` prevents double-loading; upserts are keyed by `(source_system,
source_record_key)`.
- Transform: tables are rebuilt from the same raw rows, so a rerun without new data yields
  `inserted = updated = 0` for every table and keeps each row's original `ingested_at` /
  `run_id` (verified in `apps/pipeline/src/pipeline.test.ts`).
- Property hashes include the roof-age anchor, so a permit change that moves a property's
  roof age shows up as an `updated` property delta.

## Retention

Every `run` writes a ~655 MB Parquet snapshot to `data/dataset/<run_id>/`; the Docker loop
runs every 6 h, so without pruning the disk fills within days. At the end of a successful
`run` (and standalone as `pipeline prune [--keep N] [--dry-run]`) the pipeline deletes:

- `data/dataset/<run_id>/` directories except every run with a committed publication
  (`<publications>/<run_id>/manifest.json` exists; `--publications`, `$PUBLICATIONS_DIR`,
  default `./publications` relative to the working directory, like the web), the newest
  `--keep` runs (default 2) and the run in progress.
- `data/raw/<source>/inc-*` batches older than the newest 3 per source; `full` and `sample`
  batches are kept (an incremental source with no watermark falls back to `full`).

Each deletion is one JSON log line (`run_id` / `source`+`batch`, `bytes`), followed by a
`prune summary` line; the `prune` command also prints the result (`kept`, `deleted`,
`raw_deleted`, `bytes_freed`) as JSON. `--dry-run` reports without deleting.

## Run history

`run(run_id, started_at, finished_at, status, mode, sources JSON, counts JSON, deltas JSON,
dead_letters JSON, limitations JSON, manifest_cid, root_cid, previous_run_id)`.
`sources` lists dataset id, URL, rows fetched/staged, watermark and fetch time per source;
`deltas` holds `{inserted, updated, unchanged}` per contract table. `dead_letter` keeps one
row per failed page/step. `manifest_cid` / `root_cid` are filled by the IPFS publish step.

## Measured full run (2026-11-10, this machine)

- fetch: 10.4M rows / 5.8 GB NDJSON in 8 min (4 in flight per host); 0 failed pages.
- stage: 53 s for all eight sources.
- transform: ~35 s end to end (property 11 s, permit 8 s, parquet 10 s); rerun yields zero deltas.
- outputs: `data/cook_il.duckdb` 3.1 GB, Parquet snapshot 655 MB per run (26 files, largest 55 MB).
- transform with the two relationship tables (2026-11-10, run `20261110T221716Z`): 41 s; 58,902
  `property_improvement_has_contractor` rows (36,786 exact 0.80 / 21,570 suffix-stripped 0.70 / 546 dba 0.70 out
  of 1,070,513 permits with a contractor name), 33,512 `contractor_has_license` rows; `pipeline bbb --limit 150`: 116 s.
- A run row left `running` by a killed process is marked `failed` with an `interrupted` dead letter
  by the next run.

## Dead letters

Fetch failures never abort a run: the page is recorded, the batch stays incomplete, the run
finishes with the rest of the sources and the next run retries. Transform errors mark the run
`failed` with the error in `dead_letters`.

## Limitations

See `docs/sources.md` and the `limitations` column of every run row: no permit close dates,
Chicago pre-2006 permits without status, suburban permit portals not bulk-available, Clerk /
Treasurer / Chicago trade licenses not loadable, contractor identity is a name match (no license/phone on
permits), BBB reachable only through Internet Archive copies (`docs/bbb.md`).
