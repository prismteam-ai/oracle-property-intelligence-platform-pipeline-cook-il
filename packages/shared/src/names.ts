/** Name normalization for contractor matching. Tier 1 = exact normalized; tier 2 = without suffixes. */
const SUFFIXES = new Set([
  "INC",
  "INCORPORATED",
  "LLC",
  "L L C",
  "LTD",
  "LIMITED",
  "CO",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "LLP",
  "LP",
  "PC",
  "PLLC",
  "DBA",
  "THE",
]);

export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripSuffixes(normalized: string): string {
  const words = normalized.split(" ").filter((w) => w && !SUFFIXES.has(w));
  return words.join(" ");
}

/** Mirrors normalizeName in DuckDB SQL for bulk use. */
export const SQL_NORMALIZE_NAME = (col: string) =>
  `trim(regexp_replace(regexp_replace(replace(upper(${col}), '&', ' AND '), '[^A-Z0-9 ]+', ' ', 'g'), '\\s+', ' ', 'g'))`;

export const SQL_STRIP_SUFFIXES = (col: string): string => {
  const alt = [...SUFFIXES].filter((s) => !s.includes(" ")).join("|");
  // RE2 has no lookahead: strip padded tokens twice so adjacent suffixes ("CO INC") both go.
  const once = (x: string) => `regexp_replace(${x}, '\\s(${alt})\\s', ' ', 'g')`;
  return `trim(regexp_replace(${once(once(`' ' || ${col} || ' '`))}, '\\s+', ' ', 'g'))`;
};
