import { invokeAgent, parseInvokeArgs } from "../apps/agent-handler/src/agent/invoke.js";

try {
  const { url, question } = parseInvokeArgs(process.argv.slice(2));
  const result = await invokeAgent(url, question);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Do not echo arbitrary upstream payloads, URLs, arguments or credential-bearing fetch errors.
  const safe =
    error instanceof Error &&
    /^(Hosted agent|Agent URL|--url requires|Unknown option)/.test(error.message);
  console.error(
    safe && error instanceof Error
      ? error.message
      : "Agent invocation failed; check the question, URL and hosted runtime.",
  );
  process.exitCode = 1;
}
