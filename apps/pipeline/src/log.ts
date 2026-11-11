import pino from "pino";

export const log = pino({ level: process.env["LOG_LEVEL"] ?? "info", base: { app: "pipeline" } });
export type Logger = pino.Logger;

export function newRunId(now = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
