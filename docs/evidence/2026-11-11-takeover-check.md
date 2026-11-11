# Takeover validation — 2026-11-11

Initial deployed revision: `49ddf03`; CRM companion: `8add166`. Both public health checks passed, serving run `20261110T221716Z` from integrity-checked Parquet.

Chromium1440 hosted baseline: six passed, five failed (`takeover-49ddf03-chromium`). Three failures were stale test contracts after merged features: agent heading changed to Noctowl, the archived-BBB SQL sample increased the count to eight, and server-side sorting now performs asynchronous requests. Waiting for each sort response restored the real open-permit predicate check. All three repaired cases passed against the unchanged deployed revision (`takeover-49ddf03-test-repair`).

Two genuine blockers remained: missing CAR release anchors and the retired HTTP gateway pair. CAR release lookup now exposes only the three verified fork releases and preserves manifest bytes/digests; a regression verifies unknown runs receive no invented release link.

Gateway discovery: ipfs.io/dweb.link HTTP429 responses carry `Sunset: Mon, 21 Sep 2026 00:00:00 GMT` and direct users to https://gatewaychanges.ipfs.io/. The body announces service-worker-only migration; the notice confirms HTTP gateway retirement. The user explicitly approved replacing PV05 with two separately operated public gateways, IPFS Lens and Pinata. Curl retrieved the frozen watermark artifact from both (HTTP200,1205 bytes,SHA256 `f54201cd5e2125927f65206e2cf216f5d335f3e8648072f5faf7ff2c199183a9`). Filebase independently returned the same bytes. This does not establish redundant pins or current availability of every object.

No complete hosted matrix is claimed here.
