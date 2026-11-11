# Roofing classifier precision — 2026-11-11

Scope: the "open roofing permits, open ≥ 3 years" list (`is_roofing and status_is_open and open_days >= 1095`), 91 permits on the live site, published run `20261111T090844Z`.

## Method

- All numbers come from the live read-only SQL API (`/trpc/query.sql`) over the published `permit` table. The published `is_roofing` reproduces the previous rule exactly (0 mismatches over all 1,607,387 permits), so "before" is the previous rule.
- "After" applies the new rule in SQL through `roofingSql()` from `apps/pipeline/src/transform.ts`: the same expression the pipeline runs, built from the same constants as `classifyRoofing()`. The new rule only removes permits (0 permits newly classified roofing).
- Each of the 91 was labelled `roof_job` after reading the full description. `true` means the permit's work is mainly roofing: reroof, recover, roof repair or replacement, including a roofer's permit on a new building or co-primary roof work (roof + facade, or a project "for the complete roof replacement and HVAC"). `false` means roofing is one item in a renovation, is negated, is equipment on a roof, is a new structure (patio roof, dormer, terrace) or is absent. Labels and reasons are in `roofing-long-open-labels.csv`.
- **Single annotator, no adjudication.** Borderline calls (for example multi-scope fire repairs) could reasonably go the other way, so treat the precision figures as ±a few permits.

## Rule change (`packages/shared/src/roofing.ts`)

- Chicago permits whose `permit_type` does not contain `EASY PERMIT` or `EXPRESS PERMIT` (case-insensitive substring, so the Express type's en dash is irrelevant) count only as roof jobs. They need STRONG reroof wording and no multi-scope marker (`ROOFING_MULTI_SCOPE`: INTERIOR, REMODEL, RENOVAT, BUILD-OUT, DECONVER, DORMER, ADDITION, REHAB, CHANGE (OF) USE, ERECT, NEW CONSTRUCTION/BUILDING, GUT, PORCH). A missing `permit_type` uses this strict path too.
- Cook Assessor and Chicago Easy/Express permits keep `INCLUDE and (STRONG or not EXCLUDE)`. EXCLUDE now also covers roof-mounted/PV equipment, `ON (THE|EXISTING|MAIN|LEVEL n) ROOF`, roof access/level/line/walls (parapet and chimney masonry), roof structure over a patio, deck or porch, roof overhangs, occupiable/occupied roofs and roof terraces, dormers, "roof stays/to remain" and negated lists (`NO ... , ROOF`, `NO (NEW) ROOF`).
- `NO ROOFING` / `NO (RE)ROOF WORK` (`ROOFING_NEGATED`) vetoes every feed, even when STRONG wording is present.
- `roofing_match_rule` names the decisive rule: the general rule, the strict Chicago rule, or `excluded:` plus the negation, exclusion list, "needs STRONG" or multi-scope pattern.

## Precision on the 91 long-open permits

| Set           | Before            | After             |
| ------------- | ----------------- | ----------------- |
| All           | 21/91 = **23.1%** | 17/30 = **56.7%** |
| Cook Assessor | 16/30 = 53.3%     | 16/26 = 61.5%     |
| Chicago       | 5/61 = 8.2%       | 1/4 = 25.0%       |

The new rule removes 57 of the 70 permits labelled non-roof and 4 of the 21 labelled roof jobs. Recall within the set is 17/21. All 4 dropped roof jobs are Chicago `RENOVATION/ALTERATION` permits:

- `100890214` "NEW ROOF CONSTRUCTION ON EXISTING 1 STY. SINGLE FAMILY …": no STRONG wording.
- `100924157` "REPLACING FIRE DAMAGED ROOF AND EXTERIOR WALL BELOW …": no STRONG wording.
- `100947209` "… WATER FILTRATION PLANT ROOF AND FACADE RENOVATION": RENOVAT marker.
- `101002827` "CPS … COMPLETE ROOF REPLACEMENT AND HVAC RENOVATION …": RENOVAT marker.

Thirteen non-roof permits remain. Ten are Cook Assessor permits that copy Chicago-style multi-scope descriptions ("FIRE RESTORATION INTERIOR RENOVATION --- REPLACE ROOF, …", "GAZEBO ROOF", new residences with porch roofs). Two are Express permits: drywall removal after a roof leak, and an electrical-only permit with a service mast through the roof. One is a Chicago core-and-shell permit that includes "ROOFING WORK ASSOCIATED WITH NEW ROOFTOP UNIT".

A measured option that is not applied: vetoing Cook permits that match a narrow marker set (`INTERIOR (RENOVAT|REMODEL|ALTERATION|DEMO|BUILD)|REHAB|BUILD-?OUT|CHANGE (OF )?USE|DECONVER|ERECT|NEW CONSTRUCTION`). It would remove 5 more long-open permits, all labelled non-roof (17/25 = 68%), but it flips 518 Cook permits, including short genuine ones such as "REHAB ROOF".

## Counts before → after

| Group                      | Roofing           | Open roofing  | Open ≥ 1095 days |
| -------------------------- | ----------------- | ------------- | ---------------- |
| Cook Assessor              | 114,177 → 113,455 | 4,443 → 4,397 | 30 → 26          |
| Chicago Easy/Express       | 26,226 → 25,841   | 2,247 → 2,213 | 5 → 3            |
| Chicago other permit types | 6,695 → 534       | 562 → 45      | 56 → 1           |
| **Chicago total**          | 32,921 → 26,375   | 2,809 → 2,258 | 61 → 4           |
| **All**                    | 147,098 → 139,830 | 7,252 → 6,655 | 91 → 30          |

Of the 7,268 flips:

- 6,133 come from the strict Chicago rule.
- 1,092 come from the extended exclusion list (376 Chicago Easy/Express, 716 Cook).
- 43 come from the negation veto.

## Flip sanity check

The stratified seeded sample of 25 flips contains 12 Chicago other-type, 8 Cook and 5 Easy/Express permits (`order by hash(permit_id || 'flip-2026-11-11')`). It lost 2 genuine roof jobs, marked **R** below.

| #   | Group        | Excerpt                                                                | Roof job? |
| --- | ------------ | ---------------------------------------------------------------------- | --------- |
| 1   | Easy         | REMOVE/REPLACE … DEFECTIVE BRICK AT ROOF LEVEL                         | no        |
| 2   | Easy         | REMOVE AND REPLACE 2 STORY REAR PORCH … EXISTING ROOF TO REMAIN        | no        |
| 3   | Easy         | ERECT TWO CAR GARAGE … NO ROOF OVERHANG                                | no        |
| 4   | Easy         | REBUILD CHIMNEY ONLY (FROM ROOF LINE TOP)                              | no        |
| 5   | Easy         | FRONT AND COURT YARD REBUILD PARAPET WALL                              | no        |
| 6   | Chicago reno | INTERIOR RENOVATION FOR A SINGLE FAMILY RESIDENCE …                    | no        |
| 7   | Chicago reno | FRONT AND REAR PORCH SYSTEMS … EXISTING ROOF TO REMAIN                 | no        |
| 8   | Chicago reno | INTERIOR AND EXTERIOR REMODELING, REPLACE ENTRY STAIRS …               | no        |
| 9   | Chicago reno | UNOCCUPIED BUILDING - EMERGENCY REPLACEMENT OF EXISTING ROOF STRUCTURE | **R**     |
| 10  | Chicago reno | PARTIAL ROOF AND FLOOR REPAIRS … SISTER NEW 2X6 AT RAFTERS             | no        |
| 11  | Chicago reno | DECONVERT 2 DU TO SFR WITH INTERIOR ALTERATION …                       | no        |
| 12  | Chicago reno | INTERIOR & EXTERIOR ALTERATIONS … REPLACE DAMAGE ROOF …                | no        |
| 13  | Chicago reno | FULL ROOF REPLACEMENT; 11,500 SQ. FT. GREEN ROOF; MINOR INTERIOR …     | **R**     |
| 14  | Chicago reno | INTERIOR ALTERATIONS. PLUMBING FIXTURE REPLACEMENTS …                  | no        |
| 15  | Chicago reno | HOUSE GUT REHAB AND ROOF DORMER ADDITION                               | no        |
| 16  | Chicago reno | REBUILDING FIRE DAMAGED WALL AND ROOF FRAMING … INTERIOR BUILDOUT      | no        |
| 17  | Chicago reno | REMOVAL OF EXISTING GARAGE … PROPOSED 3 STORY …                        | no        |
| 18  | Cook         | REMOVE AND REPLACE … REAR 2 STORY WOOD PORCH …                         | no        |
| 19  | Cook         | CONCRETE PATIO/ROOF OVER PATIO                                         | no        |
| 20  | Cook         | PV ROOF MOUNT SYSTEM                                                   | no        |
| 21  | Cook         | GRIND AND TUCKPOINT … BELOW THE ROOF LINE                              | no        |
| 22  | Cook         | ADD ROOF OVER PORCH                                                    | no        |
| 23  | Cook         | BUILD OUT OF 23RD FLOOR ROOF TERRACE                                   | no        |
| 24  | Cook         | ROOF MOUNTED PV SYSTEM                                                 | no        |
| 25  | Cook         | BEDROOM ADDITION AND CONSTRUCT A ROOF OVER EXISTING PATIO              | no        |

Exploratory samples, unseeded and read in full:

| Group               | Genuine roof jobs lost | Example                                        |
| ------------------- | ---------------------- | ---------------------------------------------- |
| Easy/Express        | 0 of 30                | —                                              |
| Cook                | 1 of 30                | "T.O. R.R. FLAT DORMER ROOF", DORMER exclusion |
| Chicago other types | 1 of 40                | a garage roof fire-damage replacement          |

Combined, about 3 of 52 Chicago other-type flips (~6%, wide interval) are real roof jobs. That is roughly 350 of 6,133.

## Trade-offs

- **Recall on Chicago renovation permits.** Only 534 non-Easy/Express Chicago permits remain roofing. Roof replacements described without STRONG wording ("REPLACING FIRE DAMAGED ROOF", "REPLACEMENT OF EXISTING ROOF STRUCTURE") or bundled with interior work are no longer listed. This is intentional for a roofing-lead list, but it is a real recall loss.
- **Roof age.** Roof age anchors on completed `is_roofing` permits. 3,517 of 112,253 properties lose their reroof anchor and fall back to new construction or year built, with lower confidence; 3,733 anchors change in total. These figures are approximate because they ignore the year-built quarantine. Of the completed permits that no longer anchor, 787 are Chicago renovations with explicit reroof wording, where the roof was probably replaced as part of a larger job. That is lost roof-age signal. The other ~3,840 were mostly wrong anchors, for example "ROOF STAYS" porch jobs, rafter repairs, equipment and "NEW ROOF STRUCTURE OVER EXISTING OUTDOOR PATIO". If roof-age recall matters more than lead precision, a separate "roof replaced" signal for roof age would recover the 787.
- **Express templates (not fixed).** Express Permit Program templates for solar, tuckpointing, electrical and fire alarm work put the roof in a `LOCATION: ROOFING` field. That field matches STRONG wording, so 251 open Express permits that are still classified roofing after this change do not use the roof template (`SCOPE: ROOF …`). Nearly all of them are other trades. The rule for these tracks was kept by design.
- **Cook Assessor descriptions** are unchanged apart from the shared exclusions, so Chicago-style multi-scope descriptions copied into the Cook feed are the main remaining false positives; see the option above.
