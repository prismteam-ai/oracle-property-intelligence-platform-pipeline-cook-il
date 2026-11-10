import { describe, expect, it, vi } from "vitest";
import { invokeAgent, parseInvokeArgs } from "./invoke.js";

const answer = {
  answer: "PIN 123, source: https://example.test",
  model: "gpt-test",
  steps: [{ tool: "find_properties", args: {} }],
  source: { runId: "r1", rootCid: "bafytest" },
};
const response = (value: unknown, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value), { status }));

describe("hosted invoke helper", () => {
  it("uses the deployed UI handler and preserves answer, tool trace and source", async () => {
    const fetcher = response({ result: { data: answer } });
    expect(
      await invokeAgent("https://example.test", "Which roofs are older than 15 years?", fetcher),
    ).toEqual(answer);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe("https://example.test/trpc/agent.ask");
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(init?.body as string)).toEqual({
      question: "Which roofs are older than 15 years?",
      messages: [],
    });
  });
  it("validates input before making any network request and refuses credential-bearing URLs", async () => {
    const fetcher = response({});
    await expect(invokeAgent("https://example.test", "", fetcher)).rejects.toThrow();
    await expect(invokeAgent("https://user:secret@example.test", "hello", fetcher)).rejects.toThrow(
      /without embedded credentials/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports HTTP failures without exposing upstream payloads", async () => {
    await expect(
      invokeAgent("https://example.test", "question", response({ secret: "must not echo" }, 503)),
    ).rejects.toThrow("Hosted agent returned HTTP 503");
  });
  it("rejects disabled or malformed successful responses", async () => {
    await expect(
      invokeAgent(
        "https://example.test",
        "question",
        response({ result: { data: { ...answer, model: "none" } } }),
      ),
    ).rejects.toThrow(/disabled/);
    await expect(
      invokeAgent("https://example.test", "question", response({ answer: "invented" })),
    ).rejects.toThrow(/invalid response/);
  });
  it("parses quoted prompts or words and URL overrides without losing question text", () => {
    expect(parseInvokeArgs(["--url", "https://example.test", "Which", "roofs?"])).toEqual({
      url: "https://example.test",
      question: "Which roofs?",
    });
    expect(() => parseInvokeArgs(["--url"])).toThrow(/requires/);
    expect(() => parseInvokeArgs(["--unknown"])).toThrow(/Unknown option/);
  });
});
