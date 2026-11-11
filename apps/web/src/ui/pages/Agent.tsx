import { useEffect, useState } from "react";
import { AgentAnswer } from "../AgentAnswer.js";
import { trpc } from "../trpc.js";

export const AGENT_PROMPTS = [
  "Which properties in Cook County within five miles of Evanston have roofs older than 15 years?",
  "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?",
];

type Answer = Awaited<ReturnType<typeof trpc.agent.ask.mutate>>;
type Msg =
  | { role: "user"; text: string }
  | { role: "agent"; answer: Answer }
  | { role: "error"; text: string };

const STORE = "cook-il-agent-chat";
const load = (): Msg[] => {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Msg[];
  } catch {
    return [];
  }
};

/** Prior turns sent back with every question (the server builds `turn` = answer + search centre). */
type Turn = { role: "user" | "assistant"; content: string };
const history = (msgs: Msg[]): Turn[] =>
  msgs.flatMap((m): Turn[] =>
    m.role === "user"
      ? [{ role: "user", content: m.text }]
      : m.role === "agent" && m.answer.turn
        ? [{ role: "assistant", content: m.answer.turn }]
        : [],
  );

export function Agent() {
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>(load);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(msgs));
    } catch {
      /* storage unavailable: history lives in memory only */
    }
  }, [msgs]);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    const messages = history(msgs).slice(-20);
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setQ("");
    try {
      const answer = await trpc.agent.ask.mutate({ question, messages });
      setMsgs((m) => [...m, { role: "agent", answer }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Noctowl — property and permit assistant</h1>
      <p className="muted">
        The agent geocodes places, runs radius / roof-age / open-permit searches and read-only SQL,
        and must cite pin14 / permit ids with source URLs, state assumptions and name missing data.
        30 requests per minute per IP. The conversation is kept for this browser session and sent
        with every question, so &quot;near that area&quot; refers to the last search centre;
        &quot;many years&quot; means open for at least 3 years (1,095 days).
      </p>
      {msgs.length > 0 && (
        <button className="link" onClick={() => setMsgs([])} data-testid="agent-clear">
          clear conversation
        </button>
      )}
      <div className="samples">
        {AGENT_PROMPTS.map((p) => (
          <button key={p} onClick={() => ask(p)} disabled={busy} data-testid="agent-example">
            {p}
          </button>
        ))}
      </div>
      <div className="chat" data-testid="chat">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div className="msg user" key={i} data-testid="msg-user">
              {m.text}
            </div>
          ) : m.role === "error" ? (
            <div className="msg error" key={i} data-testid="msg-error">
              {m.text}
            </div>
          ) : (
            <div className="msg" key={i} data-testid="msg-agent">
              <AgentAnswer text={m.answer.answer} />
              <div className="muted" style={{ marginTop: 8 }}>
                model {m.answer.model} · tools:{" "}
                {m.answer.steps.map((s) => `${s.tool}(${JSON.stringify(s.args)})`).join(" → ") ||
                  "none"}{" "}
                · dataset run {m.answer.source.runId} · root CID {m.answer.source.rootCid ?? "—"} ·
                manifest CID {m.answer.source.manifestCid ?? "—"}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="msg muted" data-testid="agent-busy">
            Thinking…
          </div>
        )}
      </div>
      <form
        className="row"
        style={{ marginTop: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input
          style={{ flex: 1, minWidth: 240 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about properties, roofs, permits, contractors…"
          data-testid="agent-input"
        />
        <button className="primary" type="submit" disabled={busy} data-testid="agent-send">
          Ask
        </button>
      </form>
    </>
  );
}
