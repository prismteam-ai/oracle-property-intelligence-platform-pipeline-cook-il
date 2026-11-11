import pino from "pino";
import { AGENT_NAME } from "../config/index.js";
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
/** Metrics only: prompts, tool arguments, answers and credentials are never logged. */
export function recordAgentTurn(model: string, toolCalls: number, durationMs: number): void {
  logger.info({ agent: AGENT_NAME, model, toolCalls, durationMs }, "agent turn completed");
}
