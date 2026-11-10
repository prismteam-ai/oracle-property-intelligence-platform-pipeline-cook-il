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
