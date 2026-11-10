# IPFS publication (`@cook/ipfs-publish`, `pipeline publish` / `pipeline verify`)

One run's query dataset (`data/dataset/<run_id>/<table>/*.parquet`) is published as one UnixFS directory:
CIDv1, raw leaves, 256 KiB balanced chunks, so a local build, a Filebase CAR import and a Pinata folder
upload all produce the **same root CID**. Code: `packages/ipfs-publish/src/index.ts` (`buildDag`, `writeCar`,
`pinFilebase`, `pinPinata`, `verify`, `publishRun`); CLI glue: `apps/pipeline/src/publish.ts`.

```bash
pnpm build
node apps/pipeline/dist/cli.js publish --run <run_id> [--previous <run_id>] [--car-url <url>] [--verifier pipeline-host]
node apps/pipeline/dist/cli.js verify  [--run <run_id>] --verifier github-actions
```

`publish` writes

| Path                                      | Committed                  | Content                                                                                                                                                                                             |
| ----------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publications/<run_id>/manifest.json`     | yes                        | `{schema, run_id, created_at, root_cid, car:{name,size,sha256,cid}, previous_run_id, previous_root_cid, ipns, objects:[{name,cid,size,codec,sha256}], pins:[{provider,cid,at,ok,detail}], origins}` |
| `publications/<run_id>/run.json`          | yes                        | `{run_id, root_cid, manifest_cid, previous_run_id, previous_root_cid}` sidecar so the web app shows the CIDs without opening the DuckDB file                                                        |
| `publications/<run_id>/verification.json` | yes                        | `{run_id, root_cid, verified_at, verifier, gateways, checks:[{gateway,name,cid,status,size_match,digest_match,ms,fetched_at,error?}], summary:{[gateway]:{ok,total}}}`                              |
| `data/publications/<run_id>/<run_id>.car` | no (`*.car` is gitignored) | the CAR, re-importable into any IPFS node                                                                                                                                                           |

and then updates the `run` row: `root_cid` = directory CID, `manifest_cid` = **sha256 of `manifest.json`** (the
manifest is not pinned yet; when it is, this column takes its CID). `previous_run_id` / `previous_root_cid` chain the
runs; `--previous` overrides the run row's `previous_run_id` (and is written back to it). The previous root CID comes
from the previous run's row, or from its committed `publications/<previous>/manifest.json` when the row has none (the
DuckDB copy used for publishing is not always the one the previous run was published from). `--car-url` records
`car.release_url` (optional in the manifest schema), e.g. a GitHub Release asset, and the web shows "CAR: in GitHub
Release <link>" when the CAR is not on its host.

Pinning: Filebase (S3 `PutObject` with `import: car` metadata, `FILEBASE_ACCESS_KEY` / `FILEBASE_SECRET_KEY` /
`FILEBASE_BUCKET`) and Pinata (`POST https://uploads.pinata.cloud/v3/files`, `PINATA_JWT`). A provider whose
variables are missing is **skipped and recorded** in `pins` with `ok:false, detail:"skipped: ..."`; a CID mismatch is
recorded the same way. Socrata credentials are not needed for `publish` / `verify`.

Verification fetches every file object from every gateway and compares size and sha256; 3 attempts with backoff on
429 / 5xx. Default order: independent gateways first (`gw.ipfs-lens.dev`, `dget.top`, `ipfs.io`, `dweb.link`), then
the pinning providers' own gateways (`gateway.pinata.cloud`, `ipfs.filebase.io`); the web labels each as
"independent" or "pinning provider". `--gateways a,b,c` (prefixes like `https://ipfs.io/ipfs/`) overrides the list
for `publish` and `verify`.
`verify` re-runs this from the committed manifest and writes `verification-<verifier>.json` next to it, so the same
run can carry records from the pipeline host and from GitHub Actions (`.github/workflows/verify-ipfs.yml`, daily and
on demand, commits the record). The web app renders the manifest, pins and every `verification*.json` on
`/publications/<run_id>` ("verification pending" when none exists yet); the CAR is optional there (the VM keeps it under `data/publications`).

Limitations: IPNS is not used (`ipns: null`); `origins` is empty (no self-hosted node advertises the CID); the
manifest itself is not pinned, hence the sha256 stand-in for `manifest_cid`.
