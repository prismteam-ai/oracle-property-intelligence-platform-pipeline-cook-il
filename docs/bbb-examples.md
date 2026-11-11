# Reproduce available BBB evidence

The published run `20261110T221716Z` contains 21 contractors with archived BBB values. They are explicitly stale evidence, not current ratings. Other contractor states include unavailable and unknown.

A real example verified through the live pipeline MCP on 2026-11-11:

- PIN: `13033070110000`; `5933 N KENNETH AVE`.
- Coordinates: latitude `41.9890940412`, longitude `-87.7392078603`.
- Roof age: 97 years in this publication; treat its recorded basis/confidence as a proxy.
- Contractor: `HOLMAN & NACHTWEY CO`; archived BBB value `A+`, state `stale`, checked at `2026-11-10 22:15:43.433`. The checked time is not a claim that the archived rating was current then.

In the CRM, enter those coordinates, apply the pin, choose a small radius (0.5 mile), keep confidence at low/all and leave open-permits-only off. Select `5933 N KENNETH AVE` and inspect its contractor/BBB evidence. This example uses a linked permit; it does not imply an open roofing permit or a current BBB rating.

In the pipeline SQL console, select **Contractors with BBB ratings (archived evidence)** to discover other available rows, including their source profile links and evidence states. The source permits and BBB links remain public provenance.

This is reproducible data evidence, not a claim that the complete frontend matrix or demo gate passed.
