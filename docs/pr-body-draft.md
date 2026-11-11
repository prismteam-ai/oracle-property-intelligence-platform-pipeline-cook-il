# Cook County, IL — Oracle property intelligence pipeline (DuckDB + IPFS + MCP + agent)

**Live runtime:** https://cook-il.108-142-177-43.nip.io (public, no credentials)
**Demo video:** https://github.com/vsterian/oracle-property-intelligence-platform-pipeline-cook-il/releases/download/demo-video-2026-11-11/cook-il-demo.mp4 (2:23, narration only; captions in `cook-il-demo.srt`; recorded against build `6cb4880`; loading pauses are shortened and labelled on screen)
**Companion PR (Roofing CRM):** https://github.com/prismteam-ai/roofing-crm/pull/21

## Runtime and access

| Item                      | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Explorer UI               | https://cook-il.108-142-177-43.nip.io (run summary, run history, publications, SQL console, map radius search, agent, MCP docs)                                                                                                                                                                                                                                                                                                                              |
| Credentials               | none; everything is public read-only                                                                                                                                                                                                                                                                                                                                                                                                                         |
| MCP endpoint              | `POST https://cook-il.108-142-177-43.nip.io/mcp`, header `Authorization: Bearer prism-cook-il-readonly-2026` (read-only token, documented on `/mcp`)                                                                                                                                                                                                                                                                                                         |
| Latest published root CID | `bafybeieb2civjvfyij4fafd3h6slugm4noev2zjzlhc3de73sdf62a354a` (run `20261111T090844Z`, published automatically), manifest `publications/20261111T090844Z/manifest.json`, CAR in the GitHub Release `https://github.com/vsterian/oracle-property-intelligence-platform-pipeline-cook-il/releases/tag/run-20261111T090844Z`; previous root `bafybeifhz5scgrouns27paizph5zpnlxhovr6vcm6skecu67msh4ffjlaq` (run `20261110T221716Z`) stays listed and retrievable |
| Pins                      | Latest snapshot: Filebase (CAR import) **and** Pinata (folder upload), both matching the local DAG; a publication needs ≥ 2 pins and ≥ 2 fully verified gateways or it is not published. Older snapshots: Filebase plus CAR releases (Pinata free tier keeps the newest only)                                                                                                                                                                                |
| Build                     | `/build.json` reports the deployed commit (`38b7809` at the time of writing); CI runs on every push to this branch: https://github.com/vsterian/oracle-property-intelligence-platform-pipeline-cook-il/actions                                                                                                                                                                                                                                               |

## What was built

- **Sources (all real, Cook County IL):** Assessor Parcel Universe (`pabr-t5kh`), Residential Characteristics (`x54s-btds`), Parcel Addresses (`3723-97qp`), Parcel Sales (`wvhk-k5uv`), Assessor Permits (`6yjf-dfxs`); City of Chicago Building Permits (`ydr8-5enu`) and Business Licenses (`r5kz-chrr`); IDFPR Roofing Contractor licenses (`pzzh-kp68`). 10.4 M rows fetched with resumable paged downloads, 0 failed pages.
- **Loaded (run `20261111T090844Z`):** 1,864,469 properties (1,861,471 with coordinates), 1,607,387 permits (147,098 roofing; 7,252 open roofing), 33,560 licensed roofing contractors (58,902 permit links), 1,210,929 businesses, 2,688,811 sales.
- **Roofing signals:** roof age per the kit contract (completed reroof permit → high, new-construction permit → medium, year built → low; open permits never reset; cancelled/expired permits never anchor an age; anchors before 1900 or before the year built are quarantined; 977,632 roofs older than 15 years), permit open duration, contractor identity from the state licensing roster, out-of-area owners (68,740), no ownership change in 10+ years (541,127).
- **Continuous ingestion → publication → serving (automatic):** three independent services on the host. Ingestion every 6 h (≈ 2.5 min): each source fetches its own `:updated_at` window concurrently and a failing source becomes a dead letter without stopping the others; idempotent upserts by `(source_system, source_record_key)` + content hash; run history with inserted/updated/unchanged deltas, dead letters, limitations. A publisher checks hourly and publishes the newest run when data changed since the last publication (≈ 7 min, without blocking ingestion). The web switches to a newer verified publication within a minute, without a restart. Example: run `20261111T090844Z` was ingested at 09:08 UTC, published automatically at 09:18 and served at 09:19.
- **Classifier correction in that run:** permits describing rooftop units, equipment or antennas on a roof, or new-garage roof geometry are no longer counted as roofing (161,709 → 147,098); 10,324 property roof ages changed as a result. The run's permit delta reports source-record changes only, so this reclassification shows in the property delta and these counts.
- **IPFS:** CIDv1 directory root per run, CAR per root, manifest with cid/name/size/codec/sha256 for every object, previous-CID chain, verification from independent public gateways (size + digest), re-verified from GitHub Actions.
- **Query layer:** DuckDB file + Parquet snapshot; read-only SQL console; MCP server (`getDatasetInfo`, `getSchema`, `queryDataset`, `findProperties`, `getProperty`), every response carries `source{runId, rootCid, manifestCid, syncedAt}`.
- **Agent:** Vercel AI SDK tool loop (geocode → radius search → open permits → read-only SQL) answering the README prompts with PIN-cited, source-linked rows and explicit assumptions.

## Demo transcript → where to see it

| README line                                            | Where                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Pipeline run summary                                   | `/`                                                                          |
| Uploaded records by source with provenance             | `/` (source table), `/runs`                                                  |
| DuckDB-backed query layer                              | `/query`                                                                     |
| Artifact manifest                                      | `/publications/20261111T090844Z`                                             |
| Retrieve a CID from two independent gateways           | `/publications/20261111T090844Z` verification table; or the curl block below |
| Later incremental publish, new CID, prior CID resolves | `/runs` (CID per run) and `/publications`                                    |
| Radius query, roofs > 15 y with basis and provenance   | `/explore`                                                                   |
| Open roofing permits, long-open, contractor, BBB       | `/explore` (toggle)                                                          |
| Agent prompts                                          | `/agent` (one-click examples)                                                |
| MCP-ready                                              | `/mcp`                                                                       |

## Verify yourself

```bash
ROOT=bafybeieb2civjvfyij4fafd3h6slugm4noev2zjzlhc3de73sdf62a354a
curl --fail -sL "https://gw.ipfs-lens.dev/ipfs/$ROOT/source_watermark/data_0.parquet" | sha256sum
curl --fail -sL "https://gateway.pinata.cloud/ipfs/$ROOT/source_watermark/data_0.parquet" | sha256sum
# both print f54201cd5e2125927f65206e2cf216f5d335f3e8648072f5faf7ff2c199183a9 (1205 bytes), matching the manifest
curl -s -X POST https://cook-il.108-142-177-43.nip.io/mcp -H 'Authorization: Bearer prism-cook-il-readonly-2026' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getDatasetInfo","arguments":{}}}'
```

## Kit usage

Built against the Soofi team kit routing for this story (`oracle` + county skills, `metagross`, `alakazam`, `apply-engineering-guidelines`); see `docs/kit-usage.md` for what follows the kit and the stated deviations (VM hosting instead of Amplify/Lambda, DuckDB instead of the Query DB, README publication path instead of Atlas; CDK stack synthesized in CI, not deployed).

## Known limitations

- Neither permit feed carries a completion date; closure is derived from terminal status, so open duration counts from the issue date.
- Gateways: the README's example gateways `ipfs.io` and `dweb.link` retired HTTP retrieval on 2026-09-21 (https://gatewaychanges.ipfs.io/), so they answer 429 and no longer serve content. The demo proves retrieval through `gw.ipfs-lens.dev` and `gateway.pinata.cloud`, two separately operated public gateways, with matching size and SHA-256. Pinata is also a pinning provider, so this shows two gateways, not two independent pin holders. Historical 429 results stay in the committed verification records.
- Pinata's free tier holds one full snapshot, so only the newest snapshot has two pins; older ones rely on Filebase plus their CAR releases.
- Incremental windows follow each source's `:updated_at`. Cook County republishes its Assessor datasets monthly and Chicago permits roughly daily, so most refreshes fetch 0 rows; source deletions are not reconciled (upsert only).
- BBB: 21 contractors have archived A+ profiles, labelled stale with capture date unknown; 129 are unavailable after the robots check was blocked. Others are unknown, never presented as current ratings.
- Source links: record-specific source URLs were malformed in the published bytes (they returned HTTP 400). They are now generated correctly and repaired at read time without changing published bytes, manifests or CIDs; the original value is kept as `source_url_original`. Details: `docs/source-links-r3.md`.
- Verification: unit tests, build, lint and CI pass. Hosted Playwright passed 99/99 (11 cases x 9 browser/viewport variants) against build `4dafad5`, including both README prompts and the canonical demo journey. Later changes (source links, automatic publication, classifier and roof-age rules) were verified by unit/integration tests, CI and live probes; the full hosted suite was not re-run on them. The demo video shows run `20261110T221716Z`, the snapshot served when it was recorded.
- Suburban permits come from the Assessor's monthly feed (what municipalities report), not from each municipal portal; Cook County Clerk recordings and Treasurer data have no bulk export.
