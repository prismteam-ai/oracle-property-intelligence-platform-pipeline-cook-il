# Slowking round 3 — preliminary pipeline report

**Status: preliminary, incomplete walkthrough.** Native OpenCode Slowking returned this report for deployed `4dafad5`. A follow-up evaluation is running to finish both exact agent prompts, the 390px viewport, publication loading and independent gateway/CAR checks. The provisional reproducibility row also needs reconciliation with its stated PR-presence assumption. Preserve this report as evidence of the first evaluation, not the final round-3 score.

Source session: `ses_e37fc727fffeqX5tfltiu0Qvb6`. Raw output: `/tmp/opencode/prism-pipeline-slowking-r3-evaluation.jsonl`. Report below is the evaluator's original output.

---

# Candidate Evaluation — Cook County Oracle Pipeline (`4dafad50834fd99b96814e80cea352e4e017e9d1`)

## Verdict

**Fail** (strict actual gates). **Partial Pass** (provisional quality, assuming PR+demo presence only; no invented video quality).

## Total score

- **Strict (actual): 0/100**
- **Provisional (quality-only, PR/demo assumed present): 71/100**

## Scorecard — Strict (actual gates)

| Dimension                  |  Weight | Band | Points | Why                                                               |
| -------------------------- | ------: | ---: | -----: | ----------------------------------------------------------------- |
| Functional outcome         |      40 |   0% |      0 | Failed gates (PR, demo) force 0/100; no dimension points awarded. |
| Runtime & demo quality     |      20 |   0% |      0 | Failed gates (PR, demo) force 0/100.                              |
| Evidence quality           |      12 |   0% |      0 | Failed gates (PR, demo) force 0/100.                              |
| Access-boundary compliance |       8 |   0% |      0 | Failed gates (PR, demo) force 0/100.                              |
| Implementation quality     |       7 |   0% |      0 | Failed gates (PR, demo) force 0/100.                              |
| Kit-usage conformance      |       5 |   0% |      0 | Failed gates (PR, demo) force 0/100.                              |
| Reproducibility            |       4 |   0% |      0 | Failed gates (PR, demo) force 0/100.                              |
| Speed                      |       4 |   0% |      0 | Failed gates (PR, demo) force 0/100.                              |
| **Total**                  | **100** |      |  **0** | **PR gate Failed + Demo gate Failed.**                            |

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

## Scorecard — Provisional (assumes PR + demo artifact present only; no invented demo quality/content)

| Dimension                  |  Weight | Band | Points | Why                                                                                                                                                 |
| -------------------------- | ------: | ---: | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional outcome         |      40 |    — |     29 | Sum of per-point provisional scores from exercised runtime/data/code evidence.                                                                      |
| Runtime & demo quality     |      20 |  50% |     10 | Hosted runtime/MCP/UI usable; publications SPA detail/loading gaps, agent response not visibly rendered in UI snapshot; demo presence assumed only. |
| Evidence quality           |      12 |  75% |      9 | Strong MCP/run/source/CID/count evidence; gaps in end-to-end agent proof and full independent all-object IPFS retrievability.                       |
| Access-boundary compliance |       8 | 100% |      8 | Read-only hosted UI/MCP/query surfaces exercised; no direct DB/vector/blob access observed.                                                         |
| Implementation quality     |       7 |  75% |      5 | Typed monorepo, idempotent pipeline, safe SQL/MCP, tests/CI/CDK artifacts; stack/ops deviations documented (Pillar 3).                              |
| Kit-usage conformance      |       5 |  75% |      4 | Toolchain largely followed per `docs/kit-usage.md` with explicit deviations (Atlas/managed AWS/runtime stack).                                      |
| Reproducibility            |       4 |  50% |      2 | Runtime/docs/CIDs reachable, but no PR system-of-record and demo content unverified (presence-only assumption).                                     |
| Speed                      |       4 | 100% |      4 | Assignment sent 2026-11-10T17:11:00Z, latest commit 2026-11-11T00:20:23Z (~7h9m).                                                                   |
| **Total**                  | **100** |      | **71** | Provisional quality-only total (nearest int).                                                                                                       |

## Functional Outcome Breakdown — Provisional

| Evaluation point                              | Sub-weight | Band | Points | Evidence / why                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ---------: | ---: | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data coverage & entities + scale              |          8 | 100% |      8 | MCP `getDatasetInfo` (run `20261110T221716Z`, root CID `bafybeifhz5...`) counts: 1,864,469 properties, 1,607,387 permits, 33,560 contractors, 1,210,929 businesses, 2,688,811 sales, 58,902 permit-contractor links, 33,512 licenses; limitations+source block returned.                                                                                                                                                                                     |
| Roofing lead signals                          |          8 |  75% |      6 | MCP `findProperties` (41.8533328655,-87.6958457032,r=0.5,minRoofAge 0): 1,678 in radius; PIN `16243140530000` roof age 12 (`reroof_permit`, high, anchor 2014-01-21), roofing permit `chicago_permits:100524612`, contractor `idfpr:104004204` exact_normalized, BBB A+ `stale/archive/access_boundary_403`; other records show year_built basis, open permits `open_days` 511, out-of-area/ownership/sales fields. Full breadth not exhaustively exercised. |
| Radius & lead discovery UX                    |          7 | 100% |      7 | `/explore` UI (Playwright, 1440/768): lat/lon/radius, min roof age, open-roofing-only, min open years, sort (distance/roof age desc/open days desc), map/pin, Search. MCP radius query confirms filterable source-backed results.                                                                                                                                                                                                                            |
| Agent & source-backed NL answers              |          6 |  25% |      2 | `/agent` (Noctowl) shows both exact README prompts and "many years = >=3 years (1095 days)". UI click of prompt 1 produced no visible answer in accessibility snapshot after ~15s (inconclusive; possible missing LLM key/runtime issue).                                                                                                                                                                                                                    |
| Continuous/incremental pipeline & run history |          5 |  75% |      4 | `/runs` shows 11 runs with timestamps, status/mode, deltas (+ins/~upd/=unch), dead letters, `previous_run_id`, root/manifest CIDs on some runs; incremental runs present. Watermark/idempotency mechanics claimed in docs, not re-run by evaluator.                                                                                                                                                                                                          |
| IPFS CID publication & retrievability         |          6 |  50% |      3 | CIDv1 root/manifest exposed in MCP and run history; new/retained CID chain visible. `docs/evidence/2026-11-11-takeover-check.md`: user-approved IPFS Lens+Pinata replacement after HTTP gateway retirement; watermark artifact retrieved from both with matching size/SHA-256 (per doc). Redundant pins/all-object/CAR public availability not fully established by this session.                                                                            |
| **Functional outcome subtotal**               |     **40** |      | **29** | Rounded from per-point provisional (29.25).                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Gates

| Gate                                    | Status     | Concrete reason                                                                                                                                                          |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR to designated assignment repo        | **Failed** | No PR submitted/open; `docs/pr-body-draft.md` states "Pending..." and "no PR/video yet pending".                                                                         |
| Runtime (deployed, hosted, exercisable) | **Pass**   | `https://cook-il.108-142-177-43.nip.io` reachable/exercised via Playwright UI + MCP; `/build.json` returned `{"commit":"4dafad5","builtAt":"2026-11-11T00:24:07.623Z"}`. |
| Credentials                             | **Pass**   | Public UI; read-only MCP endpoint exercised with documented bearer auth (token not reproduced).                                                                          |
| Demo artifact                           | **Failed** | No demo video/artifact present/reachable (explicit in PR draft/self-assessment).                                                                                         |

## Hiring signal

- **Strengths:** Real-scale Cook County dataset and source-backed records via MCP; clear run history/CID chain; useful query/explore surfaces; strong typed monorepo/pipeline/IPFS implementation signals and documented kit alignment/deviations (Pillar 3). IPFS gateway retirement handled with user-approved Lens+Pinata evidence in docs.
- **Weaknesses:** Submission incomplete as evaluable package (no PR, no demo). Agent UI response not observed end-to-end in this session. Publication detail pages SPA-loaded in snapshots; independent retrievability/pinning proof not fully demonstrated live here.
- **Material risks:** Strict hiring gate failure; operational claims (incremental refresh, multi-gateway/all-object availability, Atlas-style publication path) partially evidenced; agent LLM/runtime dependency may fail without configured provider key.
- **Follow-ups:** (1) Provide designated-repo PR link and walkthrough/demo video showing README transcript flows. (2) Show live agent answers for both exact prompts with cited PIN/permit/source rows. (3) Demonstrate independent public retrieval of manifest/CAR and representative artifacts (size+digest) for current and prior run CIDs. (4) Show incremental publish producing a new CID while prior CID remains resolvable.

## Detail

- **Intent (one sentence):** A roofing lead analyst can find and explore source-backed Cook County properties with aging roofs and open/long-open roofing permits (with contractor/BBB context where available) within a radius through a deployed UI, agent, and MCP-ready query layer fed by continuous, CID-published ingestion. **Proven (provisional): partially** — data/query/radius/run-history/CID signals proven; agent/demo completeness not fully proven.
- **What worked (observed):** Hosted runtime/build SHA match; MCP initialize/getDatasetInfo/findProperties returned structured, source-linked records and CID provenance; `/runs` 11-run history with deltas/CIDs/previous_run_id; `/explore` radius/filter/sort/map controls; `/query` preset SQL (roofs>15y, open roofing permits with contractor/BBB, aged+open lead shortlist, out-of-area, no ownership change >10y); `/mcp` docs for tools/auth/source block.
- **What failed/blocked:** No PR and no demo => strict **0/100 Fail**. `/agent` prompt click yielded no visible response in snapshot after ~15s (inconclusive). `/publications` detail pages appeared as SPA loading in snapshots during this run.
- **Access-boundary findings:** No evidence of direct DB/vector/blob bypass in exercised surfaces; MCP/query read-only by contract/UI. X Engagement/investors-mcp boundary not applicable to this assignment.
- **Timing:** Assignment sent `2026-11-10T17:11:00Z`; latest commit `2026-11-11T00:20:23Z` (`4dafad5`); elapsed ~7h9m23s.
- **Key runtime evidence (Playwright + MCP):** Playwright exercised hosted UI at 1440 (`/`, `/runs`, `/query`, `/explore`, `/agent`, `/mcp`) and 768 (`/explore`); MCP exercised `initialize`, `getDatasetInfo`, `findProperties` (1678-in-radius sample incl roofing/contractor/BBB/provenance fields). Agent prompt/button presence confirmed; response rendering not confirmed.
- **Implementation/kit notes (Pillar 3, provisional):** Implementation 82/100 quality signal, kit conformance 81/100 aggregated (oracle-primary with metagross/alakazam/baseline), built-with-kit partial/yes; deviations: VM hosting, DuckDB vs Restate/Postgres, README publication vs Atlas, CDK synthesized not deployed, OpenAI/in-process retrieval, Filebase+Pinata. Consulted agent scores reasoned read-only from code/docs (not spawned builder sessions); confidence medium.
- **Cheapest genuine gaps to close:** (1) open designated-repo PR with runtime/demo links, (2) record short demo covering both exact agent prompts + radius/sort + publication/CID retrieval, (3) publish live proof (screens/curls) of manifest/CAR/2 independent gateway fetches for current+prior CID.
- **Execution provenance:** Independent read-only Pillar 2 (`ses_e37f7dc7affeyoAtxq20v1Osm7`, general) and Pillar 3 (`ses_e37f7dc78ffeUP8rJ3Z4kdv3d3`, general) plus orchestrator Playwright/curl/MCP checks. Read-only; no repo/wiki edits, no build/deploy/commit/push/PR; no credential-file reads; tokens not printed. GitHub reads not required (local checkout). User-approved IPFS Lens+Pinata pair noted per `docs/evidence/2026-11-11-takeover-check.md`; claims treated as docs evidence unless directly exercised.
