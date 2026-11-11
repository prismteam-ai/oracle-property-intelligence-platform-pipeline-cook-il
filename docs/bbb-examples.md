# Reproduce available BBB evidence

Published run `20261110T221716Z` contains 21 contractors with archived BBB values. They are explicitly stale evidence, not current ratings. Other states include unavailable and unknown.

A genuine roofing-permit example verified through the live pipeline MCP:

- PIN: `16243140530000`; `2108 S CALIFORNIA AVE`.
- Coordinates: latitude `41.8533328655`, longitude `-87.6958457032`.
- Roof age: 12 years in this publication.
- Roofing permit: `chicago_permits:100524612`; description `REMOVE\REPLACE ROOF.SAME AS EXISTING`.
- Contractor: `WINDWARD ROOFING & CONSTRUCTION, INC.`; archived BBB value `A+`, state `stale`. Inspect the profile link and checked timestamp in the drawer; this is not a current-rating claim.

In the CRM, enter those coordinates, apply the pin, choose radius 0.5 mile, set the roof-age threshold to **0**, keep confidence at low/all and leave open-permits-only off. Select `2108 S CALIFORNIA AVE`, then inspect its roofing permit and contractor/BBB evidence. The roof is younger than the default 15-year threshold, so lowering that threshold is necessary and must be explicit.

In the pipeline SQL console, select **Contractors with BBB ratings (archived evidence)** to discover other roofing-linked examples and source profile links.

An earlier exploratory example, `5933 N KENNETH AVE`/PIN `13033070110000`, links HOLMAN & NACHTWEY CO through a non-roofing permit. It was unsuitable for the roofing-permit drawer test and is not used as a passing roofing example. Other permits are intentionally compact summaries. No permit was reclassified to produce this evidence.

This is reproducible data evidence, not a claim that the complete frontend matrix or demo gate passed.
