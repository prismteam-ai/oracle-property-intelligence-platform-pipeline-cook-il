import { z } from "zod";
import type { Source } from "../../../web/src/mcp/contracts.js";

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
