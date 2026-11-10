import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { fmt } from './trpc.js';

const NAV = [
  ['/', 'Run summary'],
  ['/runs', 'Run history'],
  ['/publications', 'Publications'],
  ['/query', 'SQL query'],
  ['/explore', 'Explore map'],
  ['/agent', 'Agent'],
  ['/mcp', 'MCP'],
] as const;

export function Layout() {
  return (
    <>
      <header className="top">
        <span className="brand">Cook County, IL · Property Intelligence</span>
        <nav>
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}

export function Card({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="card" data-testid={testId}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub !== undefined && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Kv({ items, testId }: { items: [string, ReactNode][]; testId?: string }) {
  return (
    <dl className="kv" data-testid={testId}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table<T extends object>({
  rows,
  columns,
  testId,
  empty = 'No rows.',
}: {
  rows: T[];
  columns: { key: string; label?: string; render?: (row: T) => ReactNode; wrap?: boolean }[];
  testId?: string;
  empty?: string;
}) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="tablewrap">
      <table data-testid={testId}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.wrap ? 'wrap' : undefined}>
                {c.label ?? c.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.wrap ? 'wrap' : undefined}>
                  {c.render ? c.render(r) : fmt((r as Record<string, unknown>)[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Status({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading)
    return (
      <p className="muted" data-testid="loading">
        Loading…
      </p>
    );
  if (error)
    return (
      <p className="error" data-testid="error">
        Error: {error}
      </p>
    );
  return null;
}

export const ExtLink = ({ href, children }: { href: string | null | undefined; children?: ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {children ?? href}
    </a>
  ) : (
    <span className="muted">—</span>
  );

export function FixtureBanner({ limitations }: { limitations: string[] }) {
  if (!limitations.some((l) => l.startsWith('FIXTURE'))) return null;
  return (
    <div className="banner" data-testid="fixture-banner">
      FIXTURE DATA: this snapshot is synthetic (generated locally because no pipeline output was found).
      Counts, records and CIDs are placeholders, not real Cook County data.
    </div>
  );
}
