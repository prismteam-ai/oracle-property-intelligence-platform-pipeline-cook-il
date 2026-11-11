import { generateText, type CoreMessage } from "ai";
import type { AppContext } from "../../../web/src/context.js";
import { agentTools } from "../tools/index.js";
import { SYSTEM_PROMPT, MAX_TOOL_STEPS } from "../config/index.js";
import type { AgentMessage, AgentAnswer, Center } from "../contracts/index.js";
import { recordAgentTurn } from "../observability/index.js";
export { AgentMessage, AskInput } from "../contracts/index.js";
export type { AgentAnswer, Center } from "../contracts/index.js";
export { LONG_OPEN_DAYS, SYSTEM_PROMPT } from "../config/index.js";

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
  const started = Date.now();
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
    maxSteps: MAX_TOOL_STEPS,
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
  recordAgentTurn(ctx.model.modelId, steps.length, Date.now() - started);
  return {
    answer: result.text,
    steps: steps.map(({ tool, args }) => ({ tool, args })),
    center,
    turn: assistantTurn({ answer: result.text, center }),
    source: info.source,
    model: ctx.model.modelId,
  };
}
