import { createHash } from "node:crypto";
import { SYSTEM_FIELDS, sourceUrl, type Source } from "./sources.js";

export const PAGE_LIMIT = 50_000;
export const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface SocrataAuth {
  keyId: string;
  keySecret: string;
}

export function authHeader(a: SocrataAuth): string {
  return "Basic " + Buffer.from(`${a.keyId}:${a.keySecret}`).toString("base64");
}

export function whereClause(
  s: Source,
  incremental?: { since: string; until: string },
): string | undefined {
  const parts: string[] = [];
  if (s.where) parts.push(`(${s.where})`);
  if (incremental) {
    parts.push(`:updated_at > '${incremental.since}'`);
    parts.push(`:updated_at <= '${incremental.until}'`);
  }
  return parts.length ? parts.join(" AND ") : undefined;
}

export function pageUrl(s: Source, offset: number, limit: number, where?: string): string {
  const q = new URLSearchParams();
  q.set("$select", [...SYSTEM_FIELDS, ...s.fields].join(","));
  if (where) q.set("$where", where);
  q.set("$order", ":id");
  q.set("$limit", String(limit));
  q.set("$offset", String(offset));
  return `${sourceUrl(s)}.json?${q.toString()}`;
}

export function countUrl(s: Source, where?: string): string {
  const q = new URLSearchParams();
  q.set("$select", "count(*) as n, max(:updated_at) as max_updated_at");
  if (where) q.set("$where", where);
  return `${sourceUrl(s)}.json?${q.toString()}`;
}

export type RawRow = Record<string, unknown>;

/** Flatten a Socrata row to string values, compute key/hash. System fields become _id/_updated_at. */
export function canonicalize(s: Source, row: RawRow): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of s.fields) out[f] = toText(row[f]);
  const hash = createHash("sha256").update(JSON.stringify(out)).digest("hex");
  const keyParts = s.keyFields.map((f) => out[f]);
  const id = toText(row[":id"]);
  out["_key"] = keyParts.every((k) => k !== null && k !== "") ? keyParts.join("|") : (id ?? "");
  out["_hash"] = hash;
  out["_id"] = id;
  out["_updated_at"] = toText(row[":updated_at"]);
  return out;
}

function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return JSON.stringify(v);
}

export interface FetchJsonOptions {
  auth: SocrataAuth;
  retries?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** GET JSON with exponential backoff + jitter on 429/5xx/network errors. */
export async function fetchJson(url: string, o: FetchJsonOptions): Promise<unknown> {
  const retries = o.retries ?? 6;
  const base = o.baseDelayMs ?? 1000;
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch(url, {
        headers: { Authorization: authHeader(o.auth), Accept: "application/json" },
        signal: AbortSignal.timeout(300_000),
      });
      if (res.ok) return await res.json();
      const body = await res.text().catch(() => "");
      lastErr = new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
      if (!RETRY_STATUSES.has(res.status)) throw lastErr;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (attempt < retries) {
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : backoff(base, attempt),
        );
      }
    } catch (e) {
      if (
        e instanceof Error &&
        e.message.startsWith("HTTP ") &&
        !RETRY_STATUSES.has(Number(e.message.slice(5, 8)))
      )
        throw e;
      lastErr = e;
      if (attempt < retries) await sleep(backoff(base, attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function backoff(base: number, attempt: number): number {
  const exp = Math.min(base * 2 ** attempt, 60_000);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}
