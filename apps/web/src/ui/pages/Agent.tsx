import { useState } from 'react';
import { trpc } from '../trpc.js';

export const AGENT_PROMPTS = [
  'Which properties in Cook County within five miles of Evanston have roofs older than 15 years?',
  'Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?',
];

type Answer = Awaited<ReturnType<typeof trpc.agent.ask.mutate>>;
type Msg =
  { role: 'user'; text: string } | { role: 'agent'; answer: Answer } | { role: 'error'; text: string };

export function Agent() {
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setQ('');
    try {
      const answer = await trpc.agent.ask.mutate({ question });
      setMsgs((m) => [...m, { role: 'agent', answer }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'error', text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Agent (gpt-4.1-mini via Vercel AI SDK, tools over the dataset)</h1>
      <p className="muted">
        The agent geocodes places, runs radius / roof-age / open-permit searches and read-only SQL, and must
        cite pin14 / permit ids with source URLs, state assumptions and name missing data. 30 requests per
        minute per IP.
      </p>
      <div className="samples">
        {AGENT_PROMPTS.map((p) => (
          <button key={p} onClick={() => ask(p)} disabled={busy} data-testid="agent-example">
            {p}
          </button>
        ))}
      </div>
      <div className="chat" data-testid="chat">
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div className="msg user" key={i} data-testid="msg-user">
              {m.text}
            </div>
          ) : m.role === 'error' ? (
            <div className="msg error" key={i} data-testid="msg-error">
              {m.text}
            </div>
          ) : (
            <div className="msg" key={i} data-testid="msg-agent">
              {m.answer.answer}
              <div className="muted" style={{ marginTop: 8 }}>
                model {m.answer.model} · tools:{' '}
                {m.answer.steps.map((s) => `${s.tool}(${JSON.stringify(s.args)})`).join(' → ') || 'none'} ·
                dataset run {m.answer.source.runId} · root CID {m.answer.source.rootCid ?? '—'}
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
