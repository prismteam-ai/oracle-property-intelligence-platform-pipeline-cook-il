import { SOURCES, sourceUrl, type Source } from "./sources.js";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Trusted SQL expressions only. Match canonicalize's keyFields / Socrata :id fallback. */
export function sourceRecordUrlSql(s: Source, key: string, useRowId = "false"): string {
  const filters = s.keyFields.map((field, i) => {
    const value = s.keyFields.length === 1 ? key : `split_part(${key}, '|', ${i + 1})`;
    return `${q(`${i ? "&" : ""}${field}=`)} || url_encode(${value})`;
  });
  return `${q(`${sourceUrl(s)}.json?`)} || (case when ${useRowId}
    then '%24where=' || url_encode(${q(":id='")} || replace(${key}, ${q("'")}, ${q("''")}) || ${q("'")})
    else ${filters.join(" || ")} end)`;
}

/** Repair only the old constructor's exact output; retain unknown/custom/already-valid URLs. */
export function legacySourceUrlSql(system = "source_system", key = "source_record_key"): string {
  return `case ${SOURCES.map((s) => {
    // Legacy provenance lacks the raw fields needed to disambiguate Socrata :id fallbacks.
    const validKey =
      s.keyFields.length > 1
        ? `len(string_split(${key}, '|')) = ${s.keyFields.length} and ${s.keyFields.map((_, i) => `split_part(${key}, '|', ${i + 1}) <> ''`).join(" and ")}`
        : `${key} <> '' and not starts_with(${key}, 'row-')`;
    return `when ${system} = ${q(s.system)} and source_url = ${q(`${sourceUrl(s)}?`)} || ${key}
      and ${validKey} then ${sourceRecordUrlSql(s, key)}`;
  }).join("\n")} else source_url end`;
}
