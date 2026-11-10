import { useState } from "react";
import { Table } from "../components.js";
import { SAMPLE_QUERIES } from "../samples.js";
import { fmt, trpc } from "../trpc.js";

type Result = Awaited<ReturnType<typeof trpc.query.sql.mutate>>;

export function Query() {
  const [sql, setSql] = useState(SAMPLE_QUERIES[1]?.sql ?? "");
  const [limit, setLimit] = useState(100);
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setRes(await trpc.query.sql.mutate({ sql, limit }));
    } catch (e) {
      setRes(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Read-only SQL console (DuckDB)</h1>
      <p className="muted">
        One SELECT/WITH statement; LIMIT is capped at 1000; 10 s timeout. Tables: property, permit,
        contractor, business, sale, property_improvement_has_contractor, contractor_has_license,
        run, source_watermark.
      </p>
      <div className="samples">
        {SAMPLE_QUERIES.map((s) => (
          <button key={s.title} onClick={() => setSql(s.sql)} data-testid="sample-query">
            {s.title}
          </button>
        ))}
      </div>
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        data-testid="sql"
        spellCheck={false}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <label className="f">
          limit
          <input
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            data-testid="limit"
          />
        </label>
        <button className="primary" onClick={run} disabled={busy} data-testid="run-sql">
          {busy ? "Running…" : "Run query"}
        </button>
      </div>
      {error && (
        <p className="error" data-testid="sql-error">
          {error}
        </p>
      )}
      {res && (
        <>
          <p data-testid="sql-meta">
            {res.rowCount} rows{res.truncated ? " (truncated at limit)" : ""} · {res.ms} ms · run{" "}
            {res.source.runId} · root CID {res.source.rootCid ?? "—"}
          </p>
          <Table
            testId="sql-result"
            rows={res.rows}
            columns={res.columns.map((c) => ({
              key: c,
              render: (r: Record<string, unknown>) => fmt(r[c]),
            }))}
          />
        </>
      )}
    </>
  );
}
