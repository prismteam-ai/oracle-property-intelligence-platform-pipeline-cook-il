import { generateText, type CoreMessage } from "ai";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { agentTools } from "./tools.js";
import type { Source } from "../mcp/contracts.js";

/** Prior turns of the same browser session; the client sends them back with every question. */
export const AgentMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});
export const AskInput = z.object({
  question: z.string().min(1).max(2000),
  messages: z.array(AgentMessage).max(20).default([]),
});
export type AgentMessage = z.infer<typeof AgentMessage>;

/** "many years" when the user gives no number (README prompt 2). */
export const LONG_OPEN_DAYS = 1095;

export const SYSTEM_PROMPT = `You are the Cook County, IL property-intelligence agent for a roofing CRM. You answer ONLY from the dataset tools.
Rules:
- First geocode place names with geocode_place, then query with find_properties / open_roofing_permits / run_sql_readonly.
- Cite evidence: every property as its pin14 and every permit as its permit_id, each followed by its source_url.
- State your assumptions explicitly (radius, roof-age threshold, what "long open" means, roof_age_basis = year_built vs reroof_permit and its confidence).
- "Near that area" / "there" / "the same area" refers to the most recent search centre of this conversation (the lat/lon in the prior turns' context lines); reuse it instead of geocoding again, and say which centre you reused.
- "Many years" / "a long time" without a number means open for at least 3 years (${LONG_OPEN_DAYS} days): pass minOpenDays=${LONG_OPEN_DAYS} and state that assumption.
- For every open permit list the contractor and its BBB rating; when the rating is null write "BBB: not available (bbb_state=...)" for that contractor. Never omit the BBB line.
- Say clearly what is missing: e.g. "BBB rating unavailable (bbb_state=...)", permits without a pin14, properties without coordinates.
- Never invent records. If a tool returns nothing, say so.
- Keep answers structured: assumptions, results (table or list, max 15 rows), missing data, dataset run id / root CID from the tool's source block.`;

export interface Center {
  lat: number;
  lon: number;
  place: string | null;
}
export interface AgentAnswer {
  answer: string;
  steps: { tool: string; args: unknown }[];
  /** last search centre of this answer (geocode result or radius-tool args); the client echoes it in the next turn */
  center: Center | null;
  /** what the client sends back as this assistant turn: answer + centre line */
  turn: string;
  source: Source;
  model: string;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Last geocoded place or radius-search centre among the tool calls of one answer. */
export function centerOf(
  steps: { tool: string; args: unknown; result?: unknown }[],
): Center | null {
  let center: Center | null = null;
  let place: string | null = null;
  for (const s of steps) {
    const a = s.args as Record<string, unknown> | null;
    const r = s.result as Record<string, unknown> | null;
    if (s.tool === "geocode_place" && r && isNum(r["lat"]) && isNum(r["lon"])) {
      place = typeof a?.["place"] === "string" && a["place"] ? a["place"] : null;
      center = { lat: r["lat"], lon: r["lon"], place };
    } else if (a && isNum(a["lat"]) && isNum(a["lon"]))
      center = { lat: a["lat"], lon: a["lon"], place };
  }
  return center;
}

/** What the client stores as the assistant turn: the answer plus the centre so "near that area" resolves. */
export const assistantTurn = (a: { answer: string; center: Center | null }): string =>
  a.center
    ? `${a.answer}

(context: search centre lat ${a.center.lat}, lon ${a.center.lon}${a.center.place ? ` for "${a.center.place}"` : ""})`
    : a.answer;

export async function askAgent(
  ctx: AppContext,
  question: string,
  history: AgentMessage[] = [],
): Promise<AgentAnswer> {
  const info = await ctx.info();
  if (!ctx.model) {
    return {
      answer: "Agent disabled: OPENAI_API_KEY is not configured on this server.",
      steps: [],
      center: null,
      turn: "",
      source: info.source,
      model: "none",
    };
  }
  const messages: CoreMessage[] = [...history, { role: "user", content: question }];
  const result = await generateText({
    model: ctx.model,
    system: SYSTEM_PROMPT,
    messages,
    tools: agentTools(ctx),
    maxSteps: 8,
    temperature: 0,
  });
  const steps = result.steps.flatMap((s) =>
    s.toolCalls.map((c) => ({
      tool: c.toolName,
      args: c.args,
      result: s.toolResults.find((r) => r.toolCallId === c.toolCallId)?.result,
    })),
  );
  const center = centerOf(steps);
  return {
    answer: result.text,
    steps: steps.map(({ tool, args }) => ({ tool, args })),
    center,
    turn: assistantTurn({ answer: result.text, center }),
    source: info.source,
    model: ctx.model.modelId,
  };
}
