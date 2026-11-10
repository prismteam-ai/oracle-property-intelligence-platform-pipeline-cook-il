import { Link, useParams } from "react-router-dom";
import { ExtLink, Kv, Status, Table } from "../components.js";
import { fmt, trpc, useAsync } from "../trpc.js";

/** Gateways run by the pinning providers we upload to; the rest are independent third parties. */
const PINNING = ["https://gateway.pinata.cloud", "https://ipfs.filebase.io"];
const kind = (gateway: string) =>
  PINNING.some((g) => gateway.startsWith(g)) ? "pinning provider" : "independent";

const okClass = (v: boolean) => (v ? "ok" : "bad");

export function Publications() {
  const { runId } = useParams();
  const runs = useAsync(() => trpc.runs.list.query(), "runs");
  const latest = runs.data?.[0]?.run_id;
  const id = runId ?? latest;
  const q = useAsync(
    () => (id ? trpc.publications.get.query({ run_id: id }) : Promise.resolve(null)),
    `pub:${id ?? ""}`,
  );
  if (!runs.data) return <Status loading={runs.loading} error={runs.error} />;
  const chain = runs.data.map((r) => r.run_id);
  const d = q.data;
  const m = d?.publication.manifest ?? null;
  const carOnDisk = m ? d?.publication.files.includes(m.car.name) : false;
  return (
    <>
      <h1>Publications {id ? `· ${id}` : ""}</h1>
      <p>
        Runs:{" "}
        {chain.map((r) => (
          <span key={r}>
            <Link
              to={`/publications/${r}`}
              data-testid={`pub-link-${r}`}
              style={{ fontWeight: r === id ? 600 : 400 }}
            >
              {r}
            </Link>{" "}
          </span>
        ))}
      </p>
      <Status loading={q.loading} error={q.error} />
      {d && (
        <>
          <Kv
            testId="pub-summary"
            items={[
              ["run_id", d.run?.run_id ?? id ?? "—"],
              ["root CID", <span data-testid="root-cid">{fmt(d.root_cid)}</span>],
              ["manifest CID", `${fmt(d.manifest_cid)} (sha256 of manifest.json)`],
              ["manifest schema", fmt(m?.schema)],
              ["created at", fmt(m?.created_at)],
              ["previous root CID", fmt(m?.previous_root_cid ?? null)],
              [
                "previous run",
                (m?.previous_run_id ?? d.run?.previous_run_id) ? (
                  <Link to={`/publications/${m?.previous_run_id ?? d.run?.previous_run_id ?? ""}`}>
                    {m?.previous_run_id ?? d.run?.previous_run_id}
                  </Link>
                ) : (
                  "—"
                ),
              ],
              ["IPNS", m?.ipns ? `${m.ipns.name} → ${m.ipns.resolved_cid}` : "not used"],
              [
                "CAR",
                m ? (
                  <span data-testid="car">
                    {m.car.name} · {fmt(m.car.size)} bytes · sha256 {m.car.sha256} · cid{" "}
                    {fmt(m.car.cid)} ·{" "}
                    {carOnDisk ? (
                      "on disk"
                    ) : m.car.release_url ? (
                      <>
                        in GitHub Release <ExtLink href={m.car.release_url} />
                      </>
                    ) : (
                      "not on this host (kept under data/publications on the pipeline host)"
                    )}
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["origins", m?.origins.join(", ") || "—"],
              [
                "manifest file",
                d.publication.dir ? `${d.publication.dir}/manifest.json` : "not found on disk",
              ],
              ["files on disk", d.publication.files.join(", ") || "—"],
            ]}
          />
          <h2>Root gateway URLs (derived from the CID)</h2>
          <ul className="plain" data-testid="gateway-urls">
            {d.gateway_urls.map((g) => (
              <li key={g.gateway}>
                {g.gateway} <span className="muted">({g.kind})</span>: <ExtLink href={g.url} />
              </li>
            ))}
            {!d.gateway_urls.length && <li className="muted">no root CID recorded</li>}
          </ul>

          <h2>Pins ({m?.pins.length ?? 0})</h2>
          <Table
            testId="pins"
            rows={m?.pins ?? []}
            empty="No pin records in the manifest."
            columns={[
              { key: "provider" },
              { key: "cid" },
              { key: "at" },
              {
                key: "ok",
                render: (p) => (
                  <span className={okClass(p.ok)}>{p.ok ? "pinned" : "not pinned"}</span>
                ),
              },
              { key: "detail", render: (p) => fmt(p.detail ?? null), wrap: true },
            ]}
          />

          <h2>Objects ({d.objects.length})</h2>
          <Table
            testId="artifacts"
            rows={d.objects}
            columns={[
              { key: "name" },
              { key: "cid" },
              { key: "size", label: "size (bytes)" },
              { key: "codec" },
              { key: "sha256", render: (o) => fmt(o.sha256) },
              {
                key: "gateways",
                render: (o) =>
                  o.gateways.map((g) => (
                    <div key={g.gateway}>
                      <ExtLink href={g.url}>{g.gateway}</ExtLink>{" "}
                      <span className="muted">({g.kind})</span>
                    </div>
                  )),
              },
            ]}
          />

          <h2>Gateway verification ({d.publication.verifications.length} record(s))</h2>
          {!d.publication.verifications.length && (
            <p className="muted" data-testid="no-verification">
              Verification pending: no verification*.json for this run yet (the pipeline host writes
              verification.json at publish time, GitHub Actions adds
              verification-github-actions.json daily).
            </p>
          )}
          {d.publication.verifications.map(({ file, data: v }) => (
            <section key={file} data-testid={`verification-${v.verifier}`}>
              <h3>
                {file} · verifier <strong>{v.verifier}</strong> · verified {v.verified_at} · root{" "}
                {v.root_cid}
              </h3>
              <Table
                testId={`verification-summary-${v.verifier}`}
                rows={Object.entries(v.summary).map(([gateway, s]) => ({ gateway, ...s }))}
                columns={[
                  { key: "gateway" },
                  { key: "kind", render: (r) => kind(r.gateway) },
                  {
                    key: "ok",
                    label: "objects verified (size + sha256)",
                    render: (r) => (
                      <span className={okClass(r.ok === r.total && r.total > 0)}>
                        {r.ok} / {r.total}
                      </span>
                    ),
                  },
                ]}
              />
              <details>
                <summary>{v.checks.length} per-object checks</summary>
                <Table
                  testId={`verification-checks-${v.verifier}`}
                  rows={v.checks}
                  columns={[
                    { key: "gateway" },
                    { key: "name" },
                    { key: "cid" },
                    { key: "status" },
                    {
                      key: "size_match",
                      render: (c) => (
                        <span className={okClass(c.size_match)}>{fmt(c.size_match)}</span>
                      ),
                    },
                    {
                      key: "digest_match",
                      render: (c) => (
                        <span className={okClass(c.digest_match)}>{fmt(c.digest_match)}</span>
                      ),
                    },
                    { key: "ms" },
                    { key: "fetched_at" },
                    { key: "error", render: (c) => fmt(c.error ?? null), wrap: true },
                  ]}
                />
              </details>
            </section>
          ))}

          <h2>Manifest JSON</h2>
          <pre data-testid="manifest-json">
            {d.publication.manifest_raw ?? "no manifest.json found"}
          </pre>
        </>
      )}
    </>
  );
}
