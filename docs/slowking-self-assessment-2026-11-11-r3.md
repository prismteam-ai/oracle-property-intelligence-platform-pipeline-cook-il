# Candidate Evaluation — Cook County Oracle Pipeline (`4dafad50834fd99b96814e80cea352e4e017e9d1`) — r3 final

Preliminary r3 report (71/100 provisional) preserved as prior baseline; this final revises provisional points only from new read-only evidence and reproducibility-assumption correction (same weights/subweights).

## Verdict

**Fail** (strict actual gates). **Pass** (provisional quality, assuming PR+demo artifact presence only; no invented demo/video quality).

## Total score

- **Strict (actual): 0/100**
- **Provisional (quality-only, PR/demo assumed present): 87/100**

## Scorecard — Strict (actual gates)

| Dimension                  |  Weight | Band | Points | Why                                    |
| -------------------------- | ------: | ---: | -----: | -------------------------------------- |
| Functional outcome         |      40 |   0% |      0 | Failed gates (PR, demo) force 0/100.   |
| Runtime & demo quality     |      20 |   0% |      0 | Failed gates (PR, demo) force 0/100.   |
| Evidence quality           |      12 |   0% |      0 | Failed gates (PR, demo) force 0/100.   |
| Access-boundary compliance |       8 |   0% |      0 | Failed gates (PR, demo) force 0/100.   |
| Implementation quality     |       7 |   0% |      0 | Failed gates (PR, demo) force 0/100.   |
| Kit-usage conformance      |       5 |   0% |      0 | Failed gates (PR, demo) force 0/100.   |
| Reproducibility            |       4 |   0% |      0 | Failed gates (PR, demo) force 0/100.   |
| Speed                      |       4 |   0% |      0 | Failed gates (PR, demo) force 0/100.   |
| **Total**                  | **100** |      |  **0** | **PR gate Failed + Demo gate Failed.** |

## Functional Outcome Breakdown — Strict (actual gates)

| Evaluation point                                                                    | Sub-weight | Band | Points | Evidence / why                    |
| ----------------------------------------------------------------------------------- | ---------: | ---: | -----: | --------------------------------- |
| Data coverage & entities + scale                                                    |          8 |   0% |      0 | Gate failure (PR, demo) forces 0. |
| Roofing lead signals (roof age, open/long-open permits, contractor, BBB, ownership) |          8 |   0% |      0 | Gate failure (PR, demo) forces 0. |
| Radius & lead discovery UX                                                          |          7 |   0% |      0 | Gate failure (PR, demo) forces 0. |
| Agent & source-backed NL answers                                                    |          6 |   0% |      0 | Gate failure (PR, demo) forces 0. |
| Continuous/incremental pipeline & run history                                       |          5 |   0% |      0 | Gate failure (PR, demo) forces 0. |
| IPFS CID publication & retrievability                                               |          6 |   0% |      0 | Gate failure (PR, demo) forces 0. |
| **Functional outcome subtotal**                                                     |     **40** |      |  **0** | Failed gates (PR, demo).          |

## Scorecard — Provisional (PR+demo presence assumed only; no invented demo quality; actual gate penalties separated from real reproducibility limits)

| Dimension                  |  Weight | Band | Points | Why                                                                                                                                                           |
| -------------------------- | ------: | ---: | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional outcome         |      40 |    — |     36 | Sum of revised per-point scores from new runtime/gateway/release evidence.                                                                                    |
| Runtime & demo quality     |      20 |  75% |     15 | Hosted UI/MCP/agent exercised end-to-end; publication detail SPA did not render content in snapshots after waits (real limit); demo presence assumed only.    |
| Evidence quality           |      12 | 100% |     12 | MCP+run+UI evidence, both prompts completed with citations/tool traces, independent Lens/Pinata byte+digest match, CAR release anchors, BBB example verified. |
| Access-boundary compliance |       8 | 100% |      8 | Read-only hosted UI/MCP/query surfaces only; no direct DB/vector/blob access observed.                                                                        |
| Implementation quality     |       7 |  75% |      5 | Typed monorepo/idempotent pipeline/safe SQL+MCP/tests+CI+CDK artifacts (Pillar 3); stack/ops deviations documented.                                           |
| Kit-usage conformance      |       5 |  75% |      4 | Largely kit-aligned with explicit deviations per `docs/kit-usage.md` (Pillar 3).                                                                              |
| Reproducibility            |       4 |  75% |      3 | Build/CIDs/manifests/releases/runtime verifiable; real limit: publication detail UI not fully rendered in checks (not penalized for assumed PR presence).     |
| Speed                      |       4 | 100% |      4 | Sent 2026-11-10T17:11:00Z; latest commit 2026-11-11T00:20:23Z (gh, vsterian); elapsed ~7h9m23s.                                                               |
| **Total**                  | **100** |      | **87** | Rounded (86.5).                                                                                                                                               |

## Functional Outcome Breakdown — Provisional

| Evaluation point                              | Sub-weight | Band | Points | Evidence / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ---------: | ---: | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data coverage & entities + scale              |          8 | 100% |      8 | MCP `getDatasetInfo` (run `20261110T221716Z`, root `bafybeifhz5...`, manifest `787692e8...`): 1,864,469 properties, 1,607,387 permits, 33,560 contractors, 1,210,929 businesses, 2,688,811 sales, 58,902 permit-contractor, 33,512 licenses; source/provenance/limitations.                                                                                                                                                                                                                                            |
| Roofing lead signals                          |          8 |  75% |      6 | MCP `findProperties` (41.8533328655,-87.6958457032,r=0.5,minRoofAge 0): 1,678 in radius; PIN `16243140530000` roof 12y (`reroof_permit`, high), permit `chicago_permits:100524612`, contractor `idfpr:104004204` exact_normalized, BBB A+ `stale/archive/access_boundary_403` (verified per `docs/bbb-examples.md`); open permits with `open_days` 511, ownership/sales/out-of-area fields. Breadth not exhaustively exercised.                                                                                        |
| Radius & lead discovery UX                    |          7 | 100% |      7 | `/explore` UI exercised (768/1440): lat/lon/radius, min roof age, open-roofing-only, min open years, sort (distance/roof age desc/open days desc), map/pin/Search; MCP radius results source-backed.                                                                                                                                                                                                                                                                                                                   |
| Agent & source-backed NL answers              |          6 | 100% |      6 | Both exact prompts completed in SAME conversation (390 viewport): (1) Evanston 5mi roofs>15y → assumptions, 15 PIN-cited rows with source URLs/missing data, tool trace `geocode_place→find_properties`, run/root/manifest CIDs. (2) Follow-up “near that area… open roofing permits… many years… contractor” → `open_roofing_permits` minOpenDays 1095, 4 results (2219–1114 open days) with contractor/BBB state/permit/PIN/source URLs, assumptions/missing data, CIDs.                                             |
| Continuous/incremental pipeline & run history |          5 |  75% |      4 | `/runs` (exercised earlier + 768 nav attempt): 11 runs, timestamps/status/mode, deltas, dead letters, `previous_run_id`, root/manifest CIDs; incremental runs present. Watermarks/idempotency not re-run.                                                                                                                                                                                                                                                                                                              |
| IPFS CID publication & retrievability         |          6 |  75% |      5 | Independent curl: `source_watermark/data_0.parquet` CID `bafkreihvi...` fetched from IPFS Lens and Pinata = 1205 bytes, SHA-256 `f54201cd...` (matches manifest). CAR release anchors verified via gh (vsterian): `run-20261110T221716Z` (root `bafybeifhz5...`, CAR/manifest/verification assets) and prior `run-20261110T205226Z` (`bafybeifdj...`, previous `bafybeig7...`); manifests show CID chain. Publication detail SPA did not render content in snapshots. Not all objects/CAR bytes independently fetched. |
| **Functional outcome subtotal**               |     **40** |      | **36** |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Gates

| Gate                                    | Status     | Concrete reason                                                                                                                                     |
| --------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR to designated assignment repo        | **Failed** | No PR; `docs/pr-body-draft.md` pending only.                                                                                                        |
| Runtime (deployed, hosted, exercisable) | **Pass**   | `https://cook-il.108-142-177-43.nip.io` exercised (Playwright UI + MCP); `/build.json` `{"commit":"4dafad5","builtAt":"2026-11-11T00:24:07.623Z"}`. |
| Credentials                             | **Pass**   | Public UI + documented read-only MCP auth exercised (token not reproduced).                                                                         |
| Demo artifact                           | **Failed** | No demo video/artifact present.                                                                                                                     |

## Hiring signal

- **Strengths:** Real-scale, source-backed dataset and MCP; working radius/lead UX; both exact agent prompts answered in-session with citations, tool traces, run/CID provenance; run/CID chain; independently verified watermark bytes+digest on Lens/Pinata and GitHub CAR release anchors.
- **Weaknesses:** No PR/demo package (strict fail). Publication detail SPA pages did not render content in my snapshots despite waits. Not all IPFS objects/CARs independently fetched.
- **Material risks:** Submission incomplete for strict gates; agent/provider availability dependency; multi-gateway/all-object retrievability and incremental mechanics partially evidenced.
- **Follow-ups:** (1) Open designated-repo PR with runtime/demo links. (2) Provide demo video covering transcript flows + publication/CID retrieval. (3) Make publication detail reliably render and show manifest/CAR verification in UI. (4) Prove prior/current CID + CAR retrieval for representative/all objects from independent gateways.

## Detail

- **Intent (proven provisionally, partially→largely):** Roofing lead analyst can find/explore source-backed Cook County aging-roof/open-roofing-permit leads (contractor/BBB context) within radius via deployed UI, agent, MCP-ready query layer on continuous CID-published ingestion.
- **Exact checks (390/768/1440):** 390: `/mcp` rendered; `/agent` both exact prompts executed to completion in same conversation (prompt 1 visible immediately; follow-up clicked, waited 20s+30s+40s with periodic snapshots until response observed; total >90s observation window, no timeout/error shown). 768: `/explore` rendered (controls/map) and `/runs` nav attempted (aborted once; runs fully observed earlier at 1440). 1440: `/` (loading), `/runs` (11 runs), `/query`, `/explore`, `/agent`, `/mcp`, `/publications`/detail attempted (SPA loading after waits).
- **Publication/CAR journey:** `/runs` showed current/prior run links and CIDs/previous_run_id; `/publications` and `/publications/20261110T221716Z` did not render content in snapshots after waits. Actual CAR release anchors (gh, vsterian): current `run-20261110T221716Z` (assets: `20261110T221716Z.car`, `manifest.json`, `verification.json`, root `bafybeifhz5...`) and prior `run-20261110T205226Z` (CAR/manifest/verification, previous root `bafybeig7...`).
- **Independent gateway fetch (not docs-trust):** `curl -fsSL` `gw.ipfs-lens.dev/ipfs/bafkreihvi...` and `gateway.pinata.cloud/ipfs/bafkreihvi...` → 1205 bytes, SHA-256 `f54201cd5e2125927f65206e2cf216f5d335f3e8648072f5faf7ff2c199183a9`, matching `publications/20261110T221716Z/manifest.json` (`source_watermark/data_0.parquet`).
- **BBB example verified:** `docs/bbb-examples.md` record confirmed via MCP (`16243140530000`, `chicago_permits:100524612`, WINDWARD ROOFING & CONSTRUCTION `idfpr:104004204`, BBB A+ stale/archive/access_boundary_403).
- **Execution provenance:** Independent read-only pillars (P2 `ses_e37f7dc7affeyoAtxq20v1Osm7`, P3 `ses_e37f7dc78ffeUP8rJ3Z4kdv3d3`) + orchestrator Playwright/curl/MCP/gh checks. Corroboration only: `apps/web/test-results/hosted/final-4dafad5-chromium/` artifacts present (not substituted for walkthrough). No edits/build/deploy/commit/push/PR/credential-file reads; no tokens printed. User-approved Lens+Pinata pair noted (`docs/evidence/2026-11-11-takeover-check.md`); claims verified where directly exercised.

## Execution note added by implementation agent

Native OpenCode Slowking session `ses_e37fc727fffeqX5tfltiu0Qvb6`; final raw output `/tmp/opencode/prism-pipeline-slowking-r3-completed.jsonl`. The CLI selected its own default provider/model, rather than inheriting the parent session selection; exact model not established in this report. A subsequent CRM attempt hit that default provider's free-usage limit. CRM was relaunched explicitly with the parent session's `github-copilot/gpt-6-astra`. This is a tooling-provenance difference, not evidence of equivalent model execution or a reason to alter the score.
