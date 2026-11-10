export const MAX_LIMIT = 1000;

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|COPY|EXPORT|IMPORT|INSTALL|LOAD|PRAGMA|SET|RESET|CALL|VACUUM|CHECKPOINT|TRUNCATE|GRANT|MERGE|UPSERT|REPLACE)\b/i;

/** Allow a single read-only SELECT/WITH statement and force LIMIT <= MAX_LIMIT. Throws on anything else. */
export function guardSql(input: string, limit: number = MAX_LIMIT): string {
  const sql = input.trim().replace(/;\s*$/, '');
  if (!sql) throw new Error('empty SQL');
  if (sql.includes(';')) throw new Error('only one statement allowed');
  if (!/^(SELECT|WITH)\b/i.test(sql)) throw new Error('only SELECT/WITH statements allowed');
  if (FORBIDDEN.test(stripStrings(sql))) throw new Error('statement contains a forbidden keyword');
  const cap = Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
  return `SELECT * FROM (${sql}) AS _q LIMIT ${cap}`;
}

function stripStrings(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}
