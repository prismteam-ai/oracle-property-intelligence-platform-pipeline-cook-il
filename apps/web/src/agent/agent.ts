import { generateText } from 'ai';
import type { AppContext } from '../context.js';
import { agentTools } from './tools.js';

export const SYSTEM_PROMPT = `You are the Cook County, IL property-intelligence agent for a roofing CRM. You answer ONLY from the dataset tools.
Rules:
- First geocode place names with geocode_place, then query with find_properties / open_roofing_permits / run_sql_readonly.
- Cite evidence: every property as its pin14 and every permit as its permit_id, each followed by its source_url.
- State your assumptions explicitly (radius, roof-age threshold, what "long open" means, roof_age_basis = year_built vs reroof_permit and its confidence).
- Say clearly what is missing: e.g. "BBB rating unavailable (bbb_state=...)", permits without a pin14, properties without coordinates.
- Never invent records. If a tool returns nothing, say so.
- Keep answers structured: assumptions, results (table or list, max 15 rows), missing data, dataset run id / root CID from the tool's source block.`;

export interface AgentAnswer {
  answer: string;
  steps: { tool: string; args: unknown }[];
  source: { runId: string; rootCid: string | null; manifestCid: string | null; syncedAt: string };
  model: string;
}

export async function askAgent(ctx: AppContext, question: string): Promise<AgentAnswer> {
  const info = await ctx.info();
  if (!ctx.model) {
    return {
      answer: 'Agent disabled: OPENAI_API_KEY is not configured on this server.',
      steps: [],
      source: info.source,
      model: 'none',
    };
  }
  const result = await generateText({
    model: ctx.model,
    system: SYSTEM_PROMPT,
    prompt: question,
    tools: agentTools(ctx),
    maxSteps: 8,
    temperature: 0,
  });
  const steps = result.steps.flatMap((s) => s.toolCalls.map((c) => ({ tool: c.toolName, args: c.args })));
  return { answer: result.text, steps, source: info.source, model: ctx.model.modelId };
}
