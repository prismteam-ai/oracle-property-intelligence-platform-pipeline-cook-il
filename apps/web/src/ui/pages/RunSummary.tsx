import { Link } from 'react-router-dom';
import { Card, ExtLink, FixtureBanner, Kv, Status, Table } from '../components.js';
import { fmt, trpc, useAsync } from '../trpc.js';

export function RunSummary() {
  const q = useAsync(() => trpc.runs.latest.query(), 'latest');
  if (!q.data) return <Status loading={q.loading} error={q.error} />;
  const { run, previous, table_counts, coverage, source, dataset_origin, run_count } = q.data;
  const deltaRows = Object.entries(run.deltas).map(([table, d]) => ({
    table,
    ...d,
    previous: previous?.counts[table] ?? null,
    current: run.counts[table] ?? null,
  }));
  return (
    <>
      <h1>Pipeline run summary</h1>
      <FixtureBanner limitations={run.limitations} />
      <div className="cards">
        <Card
          label="Latest run"
          value={<span data-testid="run-id">{run.run_id}</span>}
          sub={`status: ${run.status}`}
          testId="card-run"
        />
        <Card label="Started" value={run.started_at} testId="card-started" />
        <Card label="Finished" value={run.finished_at ?? 'running'} testId="card-finished" />
        <Card
          label="Properties"
          value={fmt(table_counts.property)}
          sub={`${fmt(coverage.properties_with_coordinates)} with coordinates`}
          testId="card-property"
        />
        <Card
          label="Permits"
          value={fmt(table_counts.permit)}
          sub={`${fmt(coverage.roofing_permits)} roofing · ${fmt(coverage.open_roofing_permits)} open roofing`}
          testId="card-permit"
        />
        <Card
          label="Contractors"
          value={fmt(table_counts.contractor)}
          sub={`${fmt(coverage.contractors_with_bbb)} with BBB rating`}
          testId="card-contractor"
        />
        <Card label="Businesses" value={fmt(table_counts.business)} testId="card-business" />
        <Card label="Sales (ownership)" value={fmt(table_counts.sale)} testId="card-sale" />
        <Card label="Runs in history" value={<Link to="/runs">{fmt(run_count)}</Link>} />
      </div>

      <h2>Provenance of this snapshot</h2>
      <Kv
        testId="provenance"
        items={[
          ['run_id', run.run_id],
          ['previous_run_id', run.previous_run_id ?? '—'],
          ['root CID', run.root_cid ?? '—'],
          ['manifest CID', run.manifest_cid ?? '—'],
          ['synced at', source.syncedAt],
          [
            'served from',
            dataset_origin.kind === 'duckdb'
              ? `DuckDB file ${dataset_origin.path}`
              : `Parquet views ${dataset_origin.dir}`,
          ],
          ['publication', <Link to={`/publications/${run.run_id}`}>artifact manifest for {run.run_id}</Link>],
        ]}
      />

      <h2>Sources</h2>
      <Table
        testId="sources"
        rows={run.sources}
        columns={[
          { key: 'source_system' },
          { key: 'url', render: (r) => <ExtLink href={r.url} /> },
          { key: 'records', render: (r) => fmt(r.records) },
          { key: 'fetched_at', render: (r) => fmt(r.fetched_at) },
          { key: 'note', render: (r) => fmt(r.note), wrap: true },
        ]}
      />

      <h2>County coverage</h2>
      <div className="cards" data-testid="coverage">
        <Card label="County" value={coverage.county} />
        <Card label="Municipalities" value={fmt(coverage.municipalities)} />
        <Card
          label="Properties with coordinates"
          value={fmt(coverage.properties_with_coordinates)}
          sub={`of ${fmt(coverage.properties_total)}`}
        />
        <Card label="Roofs older than 15 y" value={fmt(coverage.roof_over_15y)} />
        <Card label="Long-open roofing permits (>3 y)" value={fmt(coverage.long_open_roofing_permits)} />
        <Card label="No ownership change > 10 y" value={fmt(coverage.no_sale_over_10y)} />
        <Card label="Out-of-area owners" value={fmt(coverage.out_of_area_owners)} />
        <Card
          label="Bounding box"
          value={
            coverage.bbox ? `${coverage.bbox.min_lat.toFixed(3)}…${coverage.bbox.max_lat.toFixed(3)}` : '—'
          }
          sub={
            coverage.bbox
              ? `lon ${coverage.bbox.min_lon.toFixed(3)}…${coverage.bbox.max_lon.toFixed(3)}`
              : undefined
          }
        />
      </div>
      <h3>Top municipalities</h3>
      <Table
        rows={coverage.top_municipalities}
        columns={[{ key: 'municipality' }, { key: 'properties' }]}
        testId="top-municipalities"
      />

      <h2>Record counts and deltas vs previous run {previous ? `(${previous.run_id})` : ''}</h2>
      <Table
        testId="deltas"
        rows={deltaRows}
        columns={[
          { key: 'table' },
          { key: 'current', label: 'count (this run)' },
          { key: 'previous', label: 'count (previous run)' },
          { key: 'added', render: (r) => fmt(r.added) },
          { key: 'changed', render: (r) => fmt(r.changed) },
          { key: 'removed', render: (r) => fmt(r.removed) },
        ]}
      />
      <h3>Live row counts in the served snapshot</h3>
      <Table
        rows={Object.entries(table_counts).map(([table, rows]) => ({ table, rows }))}
        columns={[{ key: 'table' }, { key: 'rows' }]}
        testId="table-counts"
      />

      <h2>Dead letters ({run.dead_letters.length})</h2>
      <Table
        testId="dead-letters"
        empty="No dead letters in this run."
        rows={run.dead_letters.map((d) => ({ json: JSON.stringify(d) }))}
        columns={[{ key: 'json', label: 'record', wrap: true }]}
      />

      <h2>Limitations</h2>
      <ul className="plain" data-testid="limitations">
        {run.limitations.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
        {!run.limitations.length && <li className="muted">none recorded</li>}
      </ul>
    </>
  );
}
