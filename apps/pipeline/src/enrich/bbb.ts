import type { Duck } from "@cook/duck";
import { normalizeName, stripSuffixes, type BbbSource, type BbbState } from "@cook/shared";
import type { Logger } from "../log.js";

/**
 * BBB reputation harvest, kit-compliant (skills/bbb-harvest): robots.txt first, no search URLs
 * (`/*?` is disallowed), one request at a time with a fixed delay, descriptive User-Agent, and the
 * first HTTP 403/429 ends every further bbb.org request (no proxies, no fingerprint changes).
 * Profile URLs are discovered without search through the Internet Archive CDX index; when bbb.org
 * is blocked the archived copy is read instead and the result is marked `stale`.
 * Reputation only: a BBB profile never changes contractor identity (that is the IDFPR roster).
 */
export const BBB_ORIGIN = "https://www.bbb.org";
export const CDX_URL =
  "http://web.archive.org/cdx/search/cdx?url=bbb.org/us/il/*&filter=original:.*roofing-contractors.*&filter=statuscode:200&collapse=urlkey&output=json&limit=5000";
export const USER_AGENT =
  "cook-il-property-intelligence/0.1 (open-data roofing research; one request per 3 s; stops on 403)";
export const REFRESH_DAYS = 30;
const RATING = /^([A-D][+-]?|F|NR)$/;

export type Fetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

/** Rules of the `*` user-agent group (BBB has only that group). */
export function parseRobots(txt: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    const k = key!.toLowerCase();
    if (k === "user-agent") applies = value!.trim() === "*";
    else if (applies && (k === "allow" || k === "disallow") && value!.trim())
      rules.push({ allow: k === "allow", pattern: value!.trim() });
  }
  return rules;
}

/** Longest matching rule wins (Google semantics); `*` is a wildcard, `$` anchors the end. */
export function robotsAllows(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | undefined;
  for (const r of rules) {
    const re = new RegExp(
      "^" +
        r.pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\\\$$/, "$"),
    );
    if (re.test(path) && (!best || r.pattern.length > best.pattern.length)) best = r;
  }
  return best ? best.allow : true;
}

export interface Profile {
  rating: string | null;
  accredited: boolean | null;
}

/** Reads "BBB Rating A+" and "is (not) BBB Accredited" from the profile text; falls back to the embedded JSON. */
export function parseProfile(html: string): Profile {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  const r =
    /BBB Rating\s*:?\s*([A-D][+-]?|F|NR)(?![A-Za-z0-9+-])/.exec(text) ??
    /"rating":"([^"]*)"/.exec(html);
  const rating = r && RATING.test(r[1]!) ? r[1]! : null;
  const accredited = /is BBB Accredited\b/.test(text)
    ? true
    : /not BBB Accredited\b/i.test(text)
      ? false
      : /"accredited":(true|false)/.exec(html)
        ? /"accredited":true/.test(html)
        : null;
  return { rating, accredited };
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Keys a name can match under: with/without legal suffixes, with/without "and" (BBB slugs drop "&"). */
export function nameKeys(...names: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const norm = normalizeName(n);
    if (!norm) continue;
    for (const v of [norm, stripSuffixes(norm)])
      for (const w of [v, v.replace(/\bAND\b/g, " ")]) {
        const k = compact(w);
        if (k) out.add(k);
      }
  }
  return out;
}

export interface ArchivedProfile {
  url: string;
  timestamp: string;
}

/** CDX rows -> name key -> archived profile URLs (latest capture per URL; subpages ignored). */
export function buildSlugIndex(rows: string[][]): Map<string, ArchivedProfile[]> {
  const latest = new Map<string, ArchivedProfile>();
  for (const [, timestamp, original] of rows.slice(1)) {
    if (!timestamp || !original) continue;
    const m =
      /^https?:\/\/(?:www\.)?bbb\.org(\/us\/il\/[^/?#]+\/profile\/roofing-contractors\/([^/?#]+))$/.exec(
        original,
      );
    if (!m) continue;
    const url = `${BBB_ORIGIN}${m[1]}`;
    const prev = latest.get(url);
    if (!prev || prev.timestamp < timestamp) latest.set(url, { url, timestamp });
  }
  const index = new Map<string, ArchivedProfile[]>();
  for (const p of latest.values()) {
    const slug = p.url.slice(p.url.lastIndexOf("/") + 1).replace(/-\d{4}-\d+$/, "");
    for (const k of nameKeys(slug.replace(/-/g, " "))) index.set(k, [...(index.get(k) ?? []), p]);
  }
  return index;
}

export type Candidate = {
  contractor_id: string;
  name: string;
  dba: string | null;
  permits: number;
};

export interface Block {
  status: number;
  url: string;
  at: string;
}

export interface HarvestSummary {
  candidates: number;
  skipped_recent: number;
  requests: { live: number; archive: number };
  /** Transient (5xx / network) failures after retries: no row is written, the next run retries them. */
  transient_failures: number;
  states: Record<string, number>;
  ratings: Record<string, number>;
  blocks: Block[];
  elapsed_ms: number;
}

export interface HarvestOptions {
  limit: number;
  minPermits: number;
  log: Logger;
  fetch?: Fetch;
  delayMs?: number;
  now?: () => Date;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ensureBbbSchema(db: Duck): Promise<void> {
  await db.exec(`create table if not exists bbb_lookup(
    contractor_id varchar primary key, bbb_state varchar, bbb_rating varchar, bbb_accredited boolean, bbb_url varchar,
    bbb_checked_at timestamp, bbb_reason varchar, bbb_source varchar, bbb_archive_timestamp varchar)`);
  for (const c of ["bbb_reason", "bbb_source"])
    await db.exec(`alter table contractor add column if not exists ${c} varchar`);
}

export async function harvestBbb(db: Duck, o: HarvestOptions): Promise<HarvestSummary> {
  const t0 = Date.now();
  const now = o.now ?? (() => new Date());
  const delayMs = o.delayMs ?? 3000;
  const fetchFn: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  const summary: HarvestSummary = {
    candidates: 0,
    skipped_recent: 0,
    requests: { live: 0, archive: 0 },
    transient_failures: 0,
    states: {},
    ratings: {},
    blocks: [],
    elapsed_ms: 0,
  };
  await ensureBbbSchema(db);

  // ponytail: one request at a time, fixed delay before every network call, both hosts.
  // 5xx / network errors retry 3 times with doubling delay; a 403/429 is never retried.
  let first = true;
  const get = async (url: string, kind: "live" | "archive") => {
    for (let attempt = 0; ; attempt++) {
      if (!first) await sleep(delayMs * 2 ** attempt);
      first = false;
      summary.requests[kind]++;
      let status = 0;
      let body = "";
      try {
        const res = await fetchFn(url, { headers: { "User-Agent": USER_AGENT } });
        status = res.status;
        body = status === 200 ? await res.text() : "";
      } catch (e) {
        o.log.warn({ step: "bbb", kind, url, error: String(e) }, "bbb request failed");
      }
      o.log.info({ step: "bbb", kind, url, status, attempt }, "bbb request");
      if ((status >= 500 || status === 0) && attempt < 3) continue;
      return { status, body };
    }
  };
  const blocked = () => summary.blocks[0];
  const block = (status: number, url: string) => {
    summary.blocks.push({ status, url, at: now().toISOString() });
    o.log.warn(summary.blocks[0], "bbb access boundary: no further bbb.org requests");
  };

  const skippedRecent = await db.scalar<number>(
    `select count(*) from bbb_lookup where bbb_checked_at > ?::timestamp - interval ${REFRESH_DAYS} day`,
    [now().toISOString()],
  );
  summary.skipped_recent = Number(skippedRecent);
  const candidates = await db.query<Candidate>(
    `select c.contractor_id, c.name, c.dba, count(e.permit_id)::integer as permits
     from contractor c join property_improvement_has_contractor e on e.contractor_id = c.contractor_id
     left join bbb_lookup b on b.contractor_id = c.contractor_id
     where b.contractor_id is null or b.bbb_checked_at <= ?::timestamp - interval ${REFRESH_DAYS} day
     group by 1, 2, 3, c.license_status having count(e.permit_id) >= ?
     order by (c.license_status = 'ACTIVE') desc, permits desc, c.contractor_id limit ?`,
    [now().toISOString(), o.minPermits, o.limit],
  );
  summary.candidates = candidates.length;
  if (!candidates.length) return { ...summary, elapsed_ms: Date.now() - t0 };

  // 1. robots.txt is the first bbb.org request; a 403/429 here is the access boundary.
  let rules: RobotsRule[] | null = null;
  const robots = await get(`${BBB_ORIGIN}/robots.txt`, "live");
  if (robots.status === 200) rules = parseRobots(robots.body);
  else if (robots.status === 403 || robots.status === 429)
    block(robots.status, `${BBB_ORIGIN}/robots.txt`);
  else o.log.warn({ status: robots.status }, "robots.txt unreadable; no live profile requests");

  // 2. profile URLs without search: Internet Archive CDX index of archived IL roofing-contractor profiles.
  let index = new Map<string, ArchivedProfile[]>();
  let cdxReason: string | null = null;
  const cdx = await get(CDX_URL, "archive");
  if (cdx.status === 200) {
    try {
      index = buildSlugIndex(JSON.parse(cdx.body) as string[][]);
    } catch {
      cdxReason = "cdx_unparseable";
    }
  } else if (cdx.status >= 500 || cdx.status === 0)
    throw new Error(
      `bbb: Internet Archive CDX index unavailable (HTTP ${cdx.status}); nothing recorded, rerun later`,
    );
  else cdxReason = `cdx_http_${cdx.status}`;
  o.log.info({ step: "bbb", archived_profiles: index.size, cdxReason }, "cdx index");

  for (const c of candidates) {
    const hits = new Map<string, ArchivedProfile>();
    for (const k of nameKeys(c.name, c.dba)) for (const p of index.get(k) ?? []) hits.set(p.url, p);
    let row: {
      state: BbbState;
      rating: string | null;
      accredited: boolean | null;
      url: string | null;
      reason: string | null;
      source: BbbSource | null;
      archiveTs: string | null;
    } = {
      state: "unavailable",
      rating: null,
      accredited: null,
      url: null,
      reason: null,
      source: null,
      archiveTs: null,
    };
    const b = blocked();
    const boundary = b ? `access_boundary_${b.status}` : null;
    if (hits.size === 0) row.reason = cdxReason ?? boundary ?? "no_archived_profile_url";
    else if (hits.size > 1) row.reason = "ambiguous_name_slug";
    else {
      const hit = [...hits.values()][0]!;
      row.url = hit.url;
      const path = hit.url.slice(BBB_ORIGIN.length);
      if (!b && rules && !robotsAllows(rules, path)) row.reason = "robots_disallow";
      else if (!b && rules) {
        const live = await get(hit.url, "live");
        if (live.status === 200) {
          const p = parseProfile(live.body);
          row = {
            ...row,
            ...p,
            state: p.rating ? "confirmed_present" : "confirmed_empty",
            source: "live",
          };
        } else if (live.status === 403 || live.status === 429) block(live.status, hit.url);
        else if (live.status >= 500 || live.status === 0) {
          summary.transient_failures++;
          continue;
        } else row.reason = `live_http_${live.status}`;
      }
      if (row.state === "unavailable" && !row.reason) {
        const arch = await get(
          `https://web.archive.org/web/${hit.timestamp}id_/${hit.url}`,
          "archive",
        );
        if (arch.status === 200) {
          const p = parseProfile(arch.body);
          const why = blocked();
          row = {
            ...row,
            ...p,
            state: "stale",
            source: "archive",
            archiveTs: hit.timestamp,
            reason: why ? `access_boundary_${why.status}` : "live_unreadable",
          };
        } else if (arch.status >= 500 || arch.status === 0) {
          summary.transient_failures++;
          continue;
        } else row.reason = boundary ?? `archive_http_${arch.status}`;
      }
    }
    summary.states[row.state] = (summary.states[row.state] ?? 0) + 1;
    if (row.rating) summary.ratings[row.rating] = (summary.ratings[row.rating] ?? 0) + 1;
    await db.exec(
      `insert or replace into bbb_lookup values (?, ?, ?, ?, ?, ?::timestamp, ?, ?, ?)`,
      [
        c.contractor_id,
        row.state,
        row.rating,
        row.accredited,
        row.url,
        now().toISOString(),
        row.reason,
        row.source,
        row.archiveTs,
      ],
    );
  }
  await db.exec(`update contractor c set bbb_state = b.bbb_state, bbb_rating = b.bbb_rating, bbb_url = b.bbb_url,
    bbb_checked_at = b.bbb_checked_at, bbb_reason = b.bbb_reason, bbb_source = b.bbb_source
    from bbb_lookup b where b.contractor_id = c.contractor_id`);
  return { ...summary, elapsed_ms: Date.now() - t0 };
}
