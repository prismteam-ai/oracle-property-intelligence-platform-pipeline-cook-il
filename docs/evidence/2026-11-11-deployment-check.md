# Deployment check — 2026-11-11

Pipeline code: `f2666b9`; CRM code: `45af5d1`.

Both `/health` endpoints and `/build.json` were probed after image transfer and compose restart. Pipeline reports `dataset: parquet`, served run `20261110T221716Z`, root `bafybeifhz5scgrouns27paizph5zpnlxhovr6vcm6skecu67msh4ffjlaq`.

The pipeline image exported `/app/data/run-history.json`, then the web service restarted with `REQUIRE_PUBLISHED_SNAPSHOT=true`. The ingestion service was recreated with the new image and began incremental run `20261110T233826Z`. While it transformed sale/contractor/business tables under the ingestion database write lock, 12 successive public health requests all returned HTTP 200 with the same published Parquet identity (maximum 199 ms); raw results are adjacent in `2026-11-11-concurrent-ingestion-health.json`.

Before this change, restarting ingestion produced health 503 with DuckDB lock errors. The new unit regression additionally holds the writer lock in a child process and proves that published queries, history and provenance remain available, rejects host-file reads, rejects tampered artifact bytes, and excludes unmanifested files.

Real MCP `findProperties` probes using either `minRoofAge: 150` or `minRoofAgeYears: 150`, Evanston centre 42.0451/-87.6877, radius 2 miles, limit 10 returned HTTP 200, filtered total 56 and 10 rows with minimum age 150. Credentials were loaded in process from the ignored environment file and were not recorded.

This is deployment/integration evidence, not a complete frontend matrix. Run history is captured at web startup and refreshes on a controlled web restart; newer ingestion never changes the served publication until an operator selects and deploys a verified publication.
