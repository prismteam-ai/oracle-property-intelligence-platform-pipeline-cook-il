import { Link } from "react-router-dom";
import { Status, Table } from "../components.js";
import { fmt, trpc, useAsync } from "../trpc.js";

export function Runs() {
  const q = useAsync(() => trpc.runs.list.query(), "runs");
  if (!q.data) return <Status loading={q.loading} error={q.error} />;
  const tables = ["property", "permit", "contractor", "business", "sale"];
  return (
    <>
      <h1>Run history ({q.data.length} runs)</h1>
      <p className="muted">
        Every run keeps its own root CID; a republish produces a new CID and never mutates the
        previous one.
      </p>
      <Table
        testId="runs"
        rows={q.data}
        columns={[
          {
            key: "run_id",
            render: (r) => <Link to={`/publications/${r.run_id}`}>{r.run_id}</Link>,
          },
          { key: "status" },
          { key: "mode" },
          { key: "started_at" },
          { key: "finished_at", render: (r) => fmt(r.finished_at) },
          ...tables.map((t) => ({
            key: t,
            label: `${t} (+ins / ~upd / =unch)`,
            render: (r: (typeof q.data)[number]) => {
              const d = r.deltas[t];
              return `${fmt(r.counts[t])} (+${fmt(d?.inserted ?? 0)} / ~${fmt(d?.updated ?? 0)} / =${fmt(d?.unchanged ?? 0)})`;
            },
          })),
          { key: "dead_letters", label: "dead letters", render: (r) => r.dead_letters.length },
          { key: "root_cid", label: "root CID", render: (r) => fmt(r.root_cid) },
          { key: "manifest_cid", label: "manifest CID", render: (r) => fmt(r.manifest_cid) },
          { key: "previous_run_id", render: (r) => fmt(r.previous_run_id) },
        ]}
      />
    </>
  );
}
