# Noctowl agent handler

Noctowl answers Cook County roofing questions using the published query snapshot. The HTTP UI and CLI both invoke the same handler and tool set; there is one SDK-managed AI turn implementation.

The source now follows the useful parts of `build-ai-agents`:

- `apps/agent-handler/src/agent`: AI turn, conversation context and hosted invocation client.
- `config`: Noctowl identity, prompt and bounded tool-step limit.
- `contracts`: Zod question/conversation schemas and answer types.
- `tools`: explicit Zod-validated geocoder, property search, open permits and read-only SQL.
- `observability`: model, tool-call count and duration metrics, without prompts or tool arguments.

The web router retains compatibility reexports from `apps/web/src/agent`. The web TypeScript build emits the shared source into its server bundle. This is a shared handler package, not a second deployed service or Lambda.

## Invoke the live agent

After `pnpm install --frozen-lockfile`:

```bash
pnpm invoke-agent 'Which properties within five miles of Evanston have roofs older than 15 years?'
pnpm invoke-agent --url https://cook-il.108-142-177-43.nip.io 'Which properties near Evanston have open roofing permits that have been open for many years?'
```

The helper POSTs to the public `agent.ask` tRPC procedure, validates its response and prints JSON containing the answer, model, tool calls and dataset provenance. It needs no provider key and starts no local app. Non-2xx, malformed responses, disabled agent, invalid input and network failures produce a nonzero exit; upstream error bodies are not echoed. It times out after 120 seconds. Each call is an independent conversation; the web UI retains its existing follow-up history behavior.

Live verification on 2026-11-11: the first command answered with 15 PIN-cited Evanston properties, geocoding and property-search steps, model `gpt-4.1-mini`, dataset run `20261110T221716Z` and the published run-3 root CID. This proves the CLI against the existing deployed handler; the source-layout/Noctowl changes require their own deployment and regression before submission.

## Exact kit limitations

The pinned AI SDK is `ai@4.3.19`. Its public exports do not include `ToolLoopAgent`; the existing `generateText({ tools, maxSteps: 8 })` delegates the tool loop to the SDK. This change retains that implementation and does not introduce a hand-written loop or a misleading class named `ToolLoopAgent`. Exact conformance to the newer class requires a separate SDK/provider migration and regression; it remains an explicit limitation rather than a completed checkbox.

Accepted assessment deviations remain: Azure VM rather than AWS Lambda, OpenAI rather than Bedrock, web/tRPC rather than Asana Chat SDK ingress, client-supplied conversation history rather than AgentCore Memory, structured metrics rather than LangSmith. Moving folders alone does not establish full kit conformance or earn a claimed score increase.
