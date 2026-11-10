/**
 * One wording for a contractor's BBB rating everywhere (Explore cards, agent answers, MCP docs):
 *   stale        -> "BBB A+ (archived copy, <date>)"   (Internet Archive capture, live profile blocked)
 *   unavailable  -> "BBB: not available (<reason>)"
 *   unknown      -> "BBB: unknown (not checked)"
 */
export function bbbLabel(
  c:
    | {
        bbb_rating: string | null;
        bbb_state: string;
        bbb_reason?: string | null;
        bbb_checked_at?: string | null;
      }
    | null
    | undefined,
): string {
  if (!c) return "BBB: not available (no contractor match)";
  switch (c.bbb_state) {
    case "stale":
      return `BBB ${c.bbb_rating ?? "n/a"} (archived copy, ${c.bbb_checked_at?.slice(0, 10) ?? "date unknown"})`;
    case "unavailable":
      return `BBB: not available (${c.bbb_reason ?? "unavailable"})`;
    case "unknown":
      return "BBB: unknown (not checked)";
    case "confirmed_empty":
      return "BBB: not available (profile has no rating)";
    default:
      return c.bbb_rating ? `BBB ${c.bbb_rating}` : `BBB: not available (${c.bbb_state})`;
  }
}
