import { useEffect, useRef, useState } from 'react';
import type { Role } from '../lib/auth';
import { askAssistant, type Citation } from '../lib/assistantClient';

interface Msg { role: 'user' | 'assistant'; text: string; citations?: Citation[]; usedTool?: boolean; grounded?: boolean; error?: string }

// every one of these is answerable from the Bicep lab guide
const GUIDE_QUESTIONS = [
  'What Azure CLI command deploys a Bicep file to a resource group?',
  'How do I restrict a parameter to specific allowed values?',
  'What are the naming rules for a storage account name?',
  'What is a symbolic name in Bicep?',
];
// only learners have personal lab events for the assistant to look up
const LEARNER_QUESTIONS = ['Why did my deployment step fail?'];

export function Assistant({ token, role }: { token: string; role: Role }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const suggestions = role === 'learner' ? [...GUIDE_QUESTIONS, ...LEARNER_QUESTIONS] : GUIDE_QUESTIONS;

  // follow the newest text while it streams, unless the reader scrolled up to re-read something
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setQ('');
    setBusy(true);
    stickToBottom.current = true;
    const ac = (abort.current = new AbortController());
    setMsgs((m) => [...m, { role: 'user', text: question }, { role: 'assistant', text: '' }]);
    const patch = (f: (m: Msg) => Msg) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? f(m) : m)));
    try {
      for await (const ev of askAssistant(token, question, ac.signal)) {
        if (ev.type === 'meta') patch((m) => ({ ...m, citations: ev.citations }));
        else if (ev.type === 'tool') patch((m) => ({ ...m, usedTool: true }));
        else if (ev.type === 'delta') patch((m) => ({ ...m, text: m.text + ev.text }));
        else if (ev.type === 'done') patch((m) => ({ ...m, grounded: ev.grounded, citations: m.citations?.filter((c) => ev.cited.includes(c.n)) }));
        else if (ev.type === 'error') patch((m) => ({ ...m, error: ev.message }));
      }
    } catch (e) {
      if (!ac.signal.aborted) patch((m) => ({ ...m, error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card assistant">
      <h2>Lab assistant</h2>
      <div className="msgs" ref={listRef} onScroll={onScroll}>
        {msgs.length === 0 && (
          <div className="muted">
            Ask anything about the lab guide, or try one of these:
            <div className="suggestions">{suggestions.map((s) => <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">{m.text || (busy && i === msgs.length - 1 ? '…' : '')}</div>
            {m.usedTool && <span className="tag">used your lab events</span>}
            {m.error && <div className="error">{m.error}</div>}
            {!!m.citations?.length && (
              <ul className="cites">{m.citations.map((c) => <li key={c.n}>[{c.n}] {c.section}</li>)}</ul>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" disabled={busy} />
        <button className="primary" disabled={busy || !q.trim()}>Send</button>
      </form>
    </div>
  );
}
