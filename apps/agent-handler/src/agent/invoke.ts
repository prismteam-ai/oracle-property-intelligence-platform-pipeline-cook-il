import { z } from "zod";
import { AskInput } from "../contracts/index.js";

const Answer = z
  .object({
    answer: z.string().min(1),
    model: z.string(),
    steps: z.array(z.object({ tool: z.string(), args: z.unknown() })),
    source: z.object({ runId: z.string(), rootCid: z.string().nullable() }).passthrough(),
  })
  .passthrough();

/** Invoke the hosted handler used by the UI; never start a second local agent loop. */
export async function invokeAgent(
  baseUrl: string,
  question: string,
  fetchImpl: typeof fetch = fetch,
): Promise<z.infer<typeof Answer>> {
  const input = AskInput.parse({ question });
  const url = new URL(baseUrl);
  if (url.username || url.password || !["https:", "http:"].includes(url.protocol))
    throw new Error("Agent URL must be HTTP(S) without embedded credentials");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/trpc/agent.ask`;
  url.search = "";
  url.hash = "";
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Hosted agent returned HTTP ${response.status}`);
  const envelope = z
    .object({ result: z.object({ data: Answer }) })
    .safeParse(await response.json());
  if (!envelope.success) throw new Error("Hosted agent returned an invalid response");
  if (envelope.data.result.data.model === "none") throw new Error("Hosted agent is disabled");
  return envelope.data.result.data;
}

export function parseInvokeArgs(args: string[]): { url: string; question: string } {
  let url = "https://cook-il.108-142-177-43.nip.io";
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--url") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("--url requires a value");
      url = value;
    } else if (arg.startsWith("--"))
      throw new Error("Unknown option; use --url followed by the prompt");
    else words.push(arg);
  }
  const { question } = AskInput.parse({ question: words.join(" ") });
  return { url, question };
}
