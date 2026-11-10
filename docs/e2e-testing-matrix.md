# Hosted E2E execution matrix

The suite tests the public deployment and real published Parquet data. It never starts a fixture app. **The final release gate is incomplete:** source/build evidence, control inventory and passing test families do not imply all acceptance criteria/control states passed.

## Run

```sh
EXPECTED_SHA=<reviewed-deployed-sha> HOSTED_RUN=<unique-evidence-id> node scripts/run-hosted-e2e.mjs
```

For the authenticated MCP family, inject `MCP_HTTP_AUTH_TOKEN` into the target process, or set `MCP_ENV_FILE` to the authorized gitignored environment-file path. The launcher forwards only that token. The test uses Node fetch outside Playwright request tracing; it never prints/attaches authorization headers. Without this credential the authenticated case is explicitly BLOCKED/skipped, not N/A or passed.

Nine projects: Chromium/Firefox/WebKit ×390/768/1440. Reports, start/end SHA/run/CID/network evidence, inventories, failure screenshots and traces are under `apps/web/test-results/hosted/<run>/` and `apps/web/playwright-report/hosted/<run>/`. Retain failures and append retests. The serial runner avoids accidental load-testing.

Workstation prerequisites: Chromium path defaults to `/home/vladsterian/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome` (`CHROMIUM_PATH` overrides it). Firefox installed through Playwright. WebKit needed private unpacked Ubuntu libraries under `/tmp/prism-webkit-libs` and `WEBKIT_PATH=/tmp/prism-webkit-2272.sh` with its GIO TLS-module path. No system packages or sudo settings were changed.

## Concrete executable families

| Family            | Criteria        | Controls/assertions                                                                                                                                                                    |
| ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes/inventory  | S01–S06,P01–P02 | All seven nav destinations, back/forward/reload, current run and real counts, eight source rows, history≥3, five MCP docs tools, responsive page overflow                              |
| Publication       | P03–P04         | Current root/run manifest, artifacts/pins/verification summaries, disclosure open/close, older-run link and distinct root, rendered control inventory                                  |
| SQL samples       | P09,P12         | Each of seven sample buttons actually executes; row limit5; ownership/out-of-area queries; count query matches1,864,469                                                                |
| SQL negative      | S04,S07,P12     | DELETE, multiple statements, host-file read, bad column, empty query and limit1001 rejected; valid SELECT42 recovers                                                                   |
| Radius            | P05–P08         | Typed lat/lon/radius/roof threshold, actual returned distances and age predicates, all three sort options, open-only and duration3years, contractor/BBB output, map zoom and pin click |
| Radius negative   | P05,S04         | Invalid radius produces error; valid empty result clears error                                                                                                                         |
| Agent             | P10             | Exact two README prompts in one conversation; real answer + root CID; keyboard submit, session reload persistence and clear; empty submit produces no turn                             |
| Exact gateways    | PV05            | ipfs.io and dweb.link each fetch the manifest-listed1205-byte watermark Parquet; compare HTTP status, byte size and SHA256; preserve failures                                          |
| Canonical journey | PV01–PV11       | Ordered run/source→SQL→manifest→exact gateway pair→second/prior roots+CAR link→radius→open permits→both agent prompts→MCP docs                                                         |
| MCP negative      | P11             | No bearer returns401; UI tool docs count/schema visible                                                                                                                                |
| MCP authenticated | P11             | All five tools source identity, tools/list; SQL DELETE/multi/file-read rejection; credential never enters Playwright trace                                                             |

Every route/result-state inventory is attached as `control-inventory-*`. Inventoried is not exercised; reconcile the rendered inventory against interaction cases and report unmapped states before final signoff.

## Frozen canonical demo inputs

`PV01-PV11` uses published run`20261110T221716Z`, root`bafybeifhz5scgrouns27paizph5zpnlxhovr6vcm6skecu67msh4ffjlaq`; SQL`SELECT count(*)::INTEGER AS properties FROM property`; artifact`source_watermark/data_0.parquet`; second run`20261110T205226Z`, prior`20261110T204914Z`; Evanston center42.0451,-87.6877, radius5mi, minimum roof15years, open duration3years; known PIN`13032280210000` at4055 W GLENLAKE AVE. Prompt1 is `Which properties in Cook County within five miles of Evanston have roofs older than 15 years?`; prompt2 is `Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?`. The final video must follow this tested sequence and these frozen values.

## Evidence to date

- Build`f2666b9`, Chromium1440: four corrected hosted families pass: all routes/navigation/responsive inventory; publications/expanded verification; all seven SQL samples; actual radius/roof/open predicate, sorting and map controls. JSON`apps/web/test-results/hosted/baseline-corrected/results.json`.
- Build`f2666b9`, Firefox1440: all routes/navigation/responsive inventory passed.
- Build`353dd3f`, Chromium1440: authenticated MCP five-tool/source/read-only boundary and missing-auth401 families pass,2/2 (`authenticated-mcp-353dd3f`).
- A broad old-baseline run was interrupted for the parent deployment. The SHA guard correctly rejected the new build rather than mislabelling old/new results as equivalent; these drift/interruption results are not product regressions or final evidence.

## Outstanding release blockers/gaps

- Full nine-project final-build execution/ledger is pending. Failed/blocked/not-run or drifting cases cannot count as completion.
- Canonical PV05 explicitly requires ipfs.io AND dweb.link. Known429 responses mean alternate gateways do not satisfy this exact case. Do not waive it or relabel it passed.
- The UI currently lacks CAR release anchors for some publications (`manifest.car.release_url` absent). The canonical journey asserts the actual anchor; an external release existing alone does not make that UI action pass.
- Every source/evidence/download link destination, all older-run states, unknown-route recovery, accessibility/focus/touch/keyboard variants, prompt-provider timeout/recovery and full parameter-boundary matrix remain incomplete.
- Actual source counts/freshness limitations and BBB availability must be assessed from recorded evidence; do not reward an accurate unavailable state as a current rating.
- Criterion coverage and functional-control coverage require separate reconciliation. Test-family counts are not either coverage denominator.
