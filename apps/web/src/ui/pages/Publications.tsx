import { Link, useParams } from 'react-router-dom';
import { ExtLink, Kv, Status, Table } from '../components.js';
import { fmt, trpc, useAsync } from '../trpc.js';

export function Publications() {
  const { runId } = useParams();
  const runs = useAsync(() => trpc.runs.list.query(), 'runs');
  const latest = runs.data?.[0]?.run_id;
  const id = runId ?? latest;
  const q = useAsync(
    () => (id ? trpc.publications.get.query({ run_id: id }) : Promise.resolve(null)),
    `pub:${id ?? ''}`,
  );
  if (!runs.data) return <Status loading={runs.loading} error={runs.error} />;
  const chain = runs.data.map((r) => r.run_id);
  const d = q.data;
  return (
    <>
      <h1>Publications {id ? `· ${id}` : ''}</h1>
      <p>
        Runs:{' '}
        {chain.map((r) => (
          <span key={r}>
            <Link
              to={`/publications/${r}`}
              data-testid={`pub-link-${r}`}
              style={{ fontWeight: r === id ? 600 : 400 }}
            >
              {r}
            </Link>{' '}
          </span>
        ))}
      </p>
      <Status loading={q.loading} error={q.error} />
      {d && (
        <>
          <Kv
            testId="pub-summary"
            items={[
              ['run_id', d.run?.run_id ?? id ?? '—'],
              ['root CID', <span data-testid="root-cid">{fmt(d.root_cid)}</span>],
              ['manifest CID', fmt(d.manifest_cid)],
              ['tables CID', fmt(d.publication.manifest?.tables_cid)],
              ['previous root CID', fmt(d.publication.manifest?.previous_root_cid ?? null)],
              [
                'previous run',
                d.run?.previous_run_id ? (
                  <Link to={`/publications/${d.run.previous_run_id}`}>{d.run.previous_run_id}</Link>
                ) : (
                  '—'
                ),
              ],
              [
                'IPNS',
                d.publication.manifest?.ipns
                  ? `${d.publication.manifest.ipns.name} → ${d.publication.manifest.ipns.resolved_cid}`
                  : 'not used',
              ],
              [
                'CAR',
                d.publication.manifest?.car
                  ? `${d.publication.manifest.car.name} · cid ${fmt(d.publication.manifest.car.cid)} · ${fmt(d.publication.manifest.car.size)} bytes`
                  : '—',
              ],
              [
                'manifest file',
                d.publication.dir ? `${d.publication.dir}/manifest.json` : 'not found on disk',
              ],
              ['files on disk', d.publication.files.join(', ') || '—'],
            ]}
          />
          <h2>Root gateway URLs (derived from the CID)</h2>
          <ul className="plain" data-testid="gateway-urls">
            {d.gateway_urls.map((g) => (
              <li key={g.gateway}>
                {g.gateway}: <ExtLink href={g.url} />
              </li>
            ))}
            {!d.gateway_urls.length && <li className="muted">no root CID recorded</li>}
          </ul>

          <h2>Artifacts ({d.artifacts.length})</h2>
          <Table
            testId="artifacts"
            rows={d.artifacts}
            columns={[
              { key: 'name' },
              { key: 'cid' },
              { key: 'size', label: 'size (bytes)' },
              { key: 'codec' },
              { key: 'sha256', render: (a) => fmt(a.sha256 ?? null) },
              {
                key: 'gateways',
                render: (a) =>
                  a.gateways.map((g) => (
                    <div key={g.gateway}>
                      <ExtLink href={g.url}>{g.gateway}</ExtLink>
                    </div>
                  )),
              },
              { key: 'origins', render: (a) => (a.origins ?? []).join(' ') || '—', wrap: true },
            ]}
          />

          <h2>Gateway verification</h2>
          {d.publication.verification ? (
            <Table
              testId="verification"
              rows={d.publication.verification.results}
              columns={[
                { key: 'gateway' },
                { key: 'name', render: (r) => fmt(r.name) },
                { key: 'cid' },
                { key: 'status', render: (r) => String(r.status) },
                {
                  key: 'size_match',
                  render: (r) => (
                    <span className={r.size_match ? 'ok' : r.size_match === false ? 'bad' : 'muted'}>
                      {fmt(r.size_match)}
                    </span>
                  ),
                },
                {
                  key: 'digest_match',
                  render: (r) => (
                    <span className={r.digest_match ? 'ok' : r.digest_match === false ? 'bad' : 'muted'}>
                      {fmt(r.digest_match)}
                    </span>
                  ),
                },
                { key: 'fetched_at' },
                { key: 'url', render: (r) => <ExtLink href={r.url} /> },
                { key: 'error', render: (r) => fmt(r.error ?? null), wrap: true },
              ]}
            />
          ) : (
            <p className="muted" data-testid="no-verification">
              No verification.json for this run.
            </p>
          )}

          <h2>Manifest JSON</h2>
          <pre data-testid="manifest-json">{d.publication.manifest_raw ?? 'no manifest.json found'}</pre>
        </>
      )}
    </>
  );
}
