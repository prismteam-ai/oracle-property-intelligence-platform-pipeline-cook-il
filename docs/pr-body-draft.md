# Cook County, IL — Oracle property intelligence pipeline (DuckDB + IPFS + MCP + agent)

**Live runtime:** https://cook-il.108-142-177-43.nip.io (public, no credentials)
**Demo video:** <RELEASE_VIDEO_URL>
**Companion PR (Roofing CRM):** <CRM_PR_URL>

## Runtime and access

| Item                      | Value                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explorer UI               | https://cook-il.108-142-177-43.nip.io (run summary, run history, publications, SQL console, map radius search, agent, MCP docs)                      |
| Credentials               | none; everything is public read-only                                                                                                                 |
| MCP endpoint              | `POST https://cook-il.108-142-177-43.nip.io/mcp`, header `Authorization: Bearer prism-cook-il-readonly-2026` (read-only token, documented on `/mcp`) |
| Latest published root CID | `<ROOT_CID>` (run `<RUN_ID>`), manifest `publications/<RUN_ID>/manifest.json`, CAR in the GitHub Release `<RELEASE_URL>`                             |
| Pins                      | Filebase (CAR import) and Pinata (folder upload) for run 1 (same CID); Filebase for later runs                                                       |
| Build                     | `/build.json` shows the deployed commit; CI: <CI_RUN_URL>                                                                                            |

## What was built

- **Sources (all real, Cook County IL):** Assessor Parcel Universe (`pabr-t5kh`), Residential Characteristics (`x54s-btds`), Parcel Addresses (`3723-97qp`), Parcel Sales (`wvhk-k5uv`), Assessor Permits (`6yjf-dfxs`); City of Chicago Building Permits (`ydr8-5enu`) and Business Licenses (`r5kz-chrr`); IDFPR Roofing Contractor licenses (`pzzh-kp68`). 10.4 M rows fetched with resumable paged downloads, 0 failed pages.
- **Loaded (run `<RUN_ID>`):** 1,864,469 properties (1,861,471 with coordinates), 1,607,387 permits (161,709 roofing; 8,810 open roofing), 33,560 licensed roofing contractors (58,902 permit links), 1,210,929 businesses, 2,688,811 sales.
- **Roofing signals:** roof age per the kit contract (completed reroof permit → high, new-construction permit → medium, year built → low; open permits never reset; 974,547 roofs older than 15 years), permit open duration, contractor identity from the state licensing roster, out-of-area owners (68,740), no ownership change in 10+ years (541,127).
- **Continuous ingestion:** watermarks per source, bounded incremental windows, idempotent upserts by `(source_system, source_record_key)` + content hash, run history with inserted/updated/unchanged deltas, dead letters, limitations; scheduled every 6 h on the host.
- **IPFS:** CIDv1 directory root per run, CAR per root, manifest with cid/name/size/codec/sha256 for every object, previous-CID chain, verification from independent public gateways (size + digest), re-verified from GitHub Actions.
- **Query layer:** DuckDB file + Parquet snapshot; read-only SQL console; MCP server (`getDatasetInfo`, `getSchema`, `queryDataset`, `findProperties`, `getProperty`), every response carries `source{runId, rootCid, manifestCid, syncedAt}`.
- **Agent:** Vercel AI SDK tool loop (geocode → radius search → open permits → read-only SQL) answering the README prompts with PIN-cited, source-linked rows and explicit assumptions.

## Demo transcript → where to see it

| README line                                            | Where                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| Pipeline run summary                                   | `/`                                                                  |
| Uploaded records by source with provenance             | `/` (source table), `/runs`                                          |
| DuckDB-backed query layer                              | `/query`                                                             |
| Artifact manifest                                      | `/publications/<RUN_ID>`                                             |
| Retrieve a CID from two independent gateways           | `/publications/<RUN_ID>` verification table; or the curl block below |
| Later incremental publish, new CID, prior CID resolves | `/runs` (CID per run) and `/publications`                            |
| Radius query, roofs > 15 y with basis and provenance   | `/explore`                                                           |
| Open roofing permits, long-open, contractor, BBB       | `/explore` (toggle)                                                  |
| Agent prompts                                          | `/agent` (one-click examples)                                        |
| MCP-ready                                              | `/mcp`                                                               |

## Verify yourself

```bash
ROOT=<ROOT_CID>
curl -sL "https://gateway.pinata.cloud/ipfs/$ROOT/manifest.json" | sha256sum
curl -sL "https://gw.ipfs-lens.dev/ipfs/$ROOT/manifest.json" | sha256sum
curl -s -X POST https://cook-il.108-142-177-43.nip.io/mcp -H 'Authorization: Bearer prism-cook-il-readonly-2026' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getDatasetInfo","arguments":{}}}'
```

## Kit usage

Built against the Soofi team kit routing for this story (`oracle` + county skills, `metagross`, `alakazam`, `apply-engineering-guidelines`); see `docs/kit-usage.md` for what follows the kit and the stated deviations (VM hosting instead of Amplify/Lambda, DuckDB instead of the Query DB, README publication path instead of Atlas; CDK stack synthesized in CI, not deployed).

## Known limitations

- Neither permit feed carries a completion date; closure is derived from terminal status, so open duration counts from the issue date.
- `ipfs.io` and `dweb.link` rate-limit (429) the pipeline host; verification records them honestly and succeeds on other independent public gateways; the GitHub Actions re-verification retries from a datacenter IP.
- Pinata free tier holds one full snapshot; later runs are pinned on Filebase.
- BBB: <BBB_STATUS>.
- Suburban permits come from the Assessor's monthly feed (what municipalities report), not from each municipal portal; Cook County Clerk recordings and Treasurer data have no bulk export.

## Self-assessment

Slowking self-run: `docs/slowking-self-assessment.md` (<SCORE>).
