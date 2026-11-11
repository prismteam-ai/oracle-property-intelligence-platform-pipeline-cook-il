import { createTRPCClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { useEffect, useState } from "react";
import type { AppRouter } from "../api/router.js";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "mutation",
      true: httpLink({ url: "/trpc" }),
      false: httpBatchLink({ url: "/trpc" }),
    }),
  ],
});

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Minimal promise hook; re-runs when `key` changes. Loading = no settled result for the current key yet. */
export function useAsync<T>(fn: () => Promise<T>, key: string): Async<T> {
  const [settled, set] = useState<{ key: string; data: T | null; error: string | null } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    fn().then(
      (data) => live && set({ key, data, error: null }),
      (e: unknown) =>
        live && set({ key, data: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!settled || settled.key !== key) return { data: null, error: null, loading: true };
  return { data: settled.data, error: settled.error, loading: false };
}

export const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
};

/** manifest_cid is the manifest's own IPFS CID once pinned; unpinned records carry the manifest's sha256. */
export const manifestIdNote = (v: string | null | undefined): string =>
  !v
    ? ""
    : /^[0-9a-f]{64}$/.test(v)
      ? " (SHA-256 of manifest.json; manifest not pinned)"
      : " (IPFS CID of manifest.json)";

/** Dates before 1900 or after today come from broken source fields; render them flagged, never as facts. */
export const invalidDate = (d: string | null | undefined): boolean =>
  !!d && (d < "1900-01-01" || d.slice(0, 10) > new Date().toISOString().slice(0, 10));
export const fmtDate = (d: string | null | undefined): string =>
  invalidDate(d) ? `${d} — invalid date (source)` : fmt(d);

/**
 * Timestamps as UTC with a Z suffix, second precision. DuckDB TIMESTAMP columns come back naive
 * ("2026-11-10 22:17:16.158255"); the pipeline writes them in UTC, so they are read as UTC. Offsets are converted.
 */
export const fmtTs = (v: string | null | undefined): string => {
  if (!v) return "—";
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(v);
  if (naive) return `${naive[1]}T${naive[2]}Z`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString().replace(/\.\d{3}Z$/, "Z");
};
