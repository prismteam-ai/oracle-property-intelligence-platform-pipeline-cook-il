export const MAX_LIMIT = 1000;

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|COPY|EXPORT|IMPORT|INSTALL|LOAD|PRAGMA|SET|RESET|CALL|VACUUM|CHECKPOINT|TRUNCATE|GRANT|MERGE|UPSERT|REPLACE)\b/i;

/** Allow a single read-only SELECT/WITH statement and force LIMIT <= MAX_LIMIT. Throws on anything else. */
export function guardSql(input: string, limit: number = MAX_LIMIT): string {
  const { sql: text, code } = scan(input);
  const sql = text.trim().replace(/;\s*$/, "");
  if (!sql) throw new Error("empty SQL");
  if (code.trim().replace(/;\s*$/, "").includes(";")) throw new Error("only one statement allowed");
  if (!/^(SELECT|WITH)\b/i.test(sql)) throw new Error("only SELECT/WITH statements allowed");
  if (FORBIDDEN.test(code)) throw new Error("statement contains a forbidden keyword");
  const cap = Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
  return `SELECT * FROM (\n${sql}\n) AS _q LIMIT ${cap}`;
}

/**
 * Strip comments (`sql`) and also blank quoted text (`code`) so checks only see SQL code. Rejects unbalanced
 * parentheses, which could close the LIMIT wrapper early, and quoting this scanner does not model.
 */
function scan(input: string): { sql: string; code: string } {
  let sql = "";
  let code = "";
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "-" && input[i + 1] === "-") {
      const end = input.slice(i).search(/[\r\n]/);
      i = end < 0 ? input.length : i + end - 1;
    } else if (ch === "/" && input[i + 1] === "*") {
      const end = input.indexOf("*/", i + 2);
      if (end < 0) throw new Error("unterminated block comment");
      i = end + 1;
      sql += " ";
      code += " ";
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < input.length && !(input[j] === ch && input[j + 1] !== ch))
        j += input[j] === ch ? 2 : 1;
      if (j >= input.length) throw new Error("unterminated quoted text");
      const quoted = input.slice(i, j + 1);
      // E'...' strings take backslash escapes, which would end the literal somewhere else than here.
      if (ch === "'" && /[eE]/.test(input[i - 1] ?? "") && quoted.includes("\\"))
        throw new Error("backslash escapes in E'' strings are not allowed");
      sql += quoted;
      code += ch + ch;
      i = j;
    } else {
      // $$...$$ / $tag$...$tag$ are string literals too.
      if (ch === "$") throw new Error("dollar-quoted strings and $ are not allowed");
      depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
      if (depth < 0) throw new Error("unbalanced parentheses");
      sql += ch;
      code += ch;
    }
  }
  if (depth !== 0) throw new Error("unbalanced parentheses");
  return { sql, code };
}
