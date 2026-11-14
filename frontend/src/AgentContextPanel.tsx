import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getAgentContext, listAgentContexts, type AgentContextMessage, type AgentContextSummary, type AgentContextToolCall } from "./api";
import AgentAvatar from "./AgentAvatar";
import { teamIdentities } from "./TeamIdentity";
import "./AgentContextPanel.css";

const roles = Object.keys(teamIdentities) as (keyof typeof teamIdentities)[];
const POLL_MS = 1500;
const typeLabels: Record<string, string> = { system: "System prompt", human: "Input", ai: "Reply", tool: "Tool result" };

type Detail =
  | { kind: "call"; call: AgentContextToolCall; result?: AgentContextMessage }
  | { kind: "text"; title: string; text: string };

/** JSON reindented for reading; any other text unchanged. */
function pretty(text: string) {
  const trimmed = text.trim();
  if (!trimmed || !"{[".includes(trimmed[0])) return text;
  try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch { return text; }
}

function contextTime(updated?: number | null) {
  return updated ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(updated * 1000)) : "";
}

function contextLabel(item: AgentContextSummary) {
  if (item.key === "leader") return "Coordination";
  if (item.key.startsWith("direct:")) return "Direct assignment";
  return item.label;
}

export default function AgentContextPanel({ conversation }: { conversation: string }) {
  const [contexts, setContexts] = useState<AgentContextSummary[]>([]);
  const [agent, setAgent] = useState<string>("leader");
  // null follows the agent's newest context; a chosen key stays until changed.
  const [chosen, setChosen] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentContextMessage[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  const own = contexts.filter(item => item.agent === agent);
  const selected = own.find(item => item.key === chosen) ?? own[0];
  const key = selected?.key ?? null;

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await listAgentContexts(conversation, abort.signal);
        if (!abort.signal.aborted) { setContexts(data.contexts); setError(""); }
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load the context list");
      } finally { if (!abort.signal.aborted) timer = setTimeout(poll, POLL_MS); }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [conversation]);

  useEffect(() => {
    setMessages([]); setLoadedKey(null); follow.current = true;
    if (!key) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let revision: string | undefined;
    async function poll() {
      try {
        const data = await getAgentContext(conversation, key!, revision, abort.signal);
        if (abort.signal.aborted) return;
        if (!data.unchanged) setMessages(data.messages ?? []);
        revision = data.revision; setLoadedKey(key); setError("");
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load the context");
      } finally { if (!abort.signal.aborted) timer = setTimeout(poll, POLL_MS); }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [conversation, key]);

  useLayoutEffect(() => {
    if (feed.current && follow.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!detail) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDetail(null); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [detail]);

  const results = new Map(messages.filter(m => m.type === "tool" && m.tool_call_id).map(m => [m.tool_call_id!, m]));
  const calls = new Set(messages.flatMap(m => (m.tool_calls ?? []).map(call => call.id)).filter(Boolean));

  return <section className="log-panel agent-context-panel" role="tabpanel" aria-label="Agent context">
    <div className="context-agents" role="radiogroup" aria-label="Select an agent">
      {roles.map(role => {
        const count = contexts.filter(item => item.agent === role).length;
        const running = contexts.some(item => item.agent === role && item.running);
        return <button key={role} role="radio" aria-checked={agent === role} className={`${agent === role ? "active" : ""} ${count ? "" : "empty"}`}
          onClick={() => { setAgent(role); setChosen(null); }} title={`${teamIdentities[role].name} (${teamIdentities[role].role}) · ${count} ${count === 1 ? "context" : "contexts"}`}>
          <span className="context-agent-avatar"><AgentAvatar agent={role} />{running && <i aria-label="Running" />}</span>
          <span>{teamIdentities[role].name}</span>
        </button>;
      })}
    </div>
    <header className="panel-heading context-heading-row">
      <div>
        <strong>Context for {teamIdentities[agent as keyof typeof teamIdentities]?.name ?? agent}</strong>
        <span>What the model sees on its next call · Refreshes every {POLL_MS / 1000}s</span>
      </div>
      <span className="member-count">{messages.length} {messages.length === 1 ? "message" : "messages"}</span>
    </header>
    {own.length > 1 && <label className="context-picker">
      <span>Context</span>
      <select value={selected?.key} onChange={event => setChosen(event.target.value)}>
        {own.map((item, index) => <option key={item.key} value={item.key}>
          {item.running ? "● " : ""}{contextLabel(item)}{item.updated ? ` · ${contextTime(item.updated)}` : ""}{index === 0 ? " (latest)" : ""}
        </option>)}
      </select>
    </label>}
    {error && <p className="context-error" role="alert">{error}</p>}
    <div className="context-feed" ref={feed} onScroll={event => {
      const el = event.currentTarget;
      follow.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 32;
    }}>
      {!selected ? <div className="activity-empty">This agent has no context in this conversation yet</div>
        : loadedKey !== key ? <div className="activity-empty">Loading…</div>
        : messages.length === 0 ? <div className="activity-empty">No messages in this context</div>
        : messages.map((message, index) => {
          if (message.type === "tool" && message.tool_call_id && calls.has(message.tool_call_id)) return null;
          if (message.type === "tool") return <ToolCard key={message.id ?? index} result={message} onOpen={setDetail}
            call={{ id: message.tool_call_id, name: message.name || "tool", arguments: "" }} />;
          const long = message.type === "system" || message.type === "human";
          return <article key={message.id ?? index} className={`context-message ${message.type}`}>
            <div className="context-message-meta">{typeLabels[message.type] ?? message.type}</div>
            {message.reasoning && <details className="context-reasoning"><summary>Reasoning</summary><pre>{message.reasoning}</pre></details>}
            {message.content && (long
              ? <button className="context-text clamped" onClick={() => setDetail({ kind: "text", title: typeLabels[message.type] ?? message.type, text: message.content })} title="View full text"><pre>{message.content.slice(0, 4000)}</pre></button>
              : <pre className="context-text">{message.content}</pre>)}
            {(message.tool_calls ?? []).map((call, callIndex) => <ToolCard key={call.id ?? callIndex} call={call}
              result={call.id ? results.get(call.id) : undefined} onOpen={setDetail} />)}
          </article>;
        })}
    </div>
    {detail && <div className="context-dialog-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) setDetail(null); }}>
      <section className="context-dialog" role="dialog" aria-modal="true" aria-label={detail.kind === "call" ? detail.call.name : detail.title}>
        <header><strong>{detail.kind === "call" ? detail.call.name : detail.title}</strong><button autoFocus onClick={() => setDetail(null)} aria-label="Close">×</button></header>
        {detail.kind === "call" ? <>
          <h3>Arguments</h3>
          <pre className="context-dialog-body">{detail.call.arguments ? pretty(detail.call.arguments) : "Unavailable: this call is no longer in context"}</pre>
          <h3>Result{detail.result?.status === "error" && <span className="context-status error">Failed</span>}</h3>
          <pre className="context-dialog-body">{detail.result ? pretty(detail.result.content) : "No result yet"}</pre>
        </> : <pre className="context-dialog-body">{detail.text}</pre>}
      </section>
    </div>}
  </section>;
}

function ToolCard({ call, result, onOpen }: { call: AgentContextToolCall; result?: AgentContextMessage; onOpen: (detail: Detail) => void }) {
  const state = call.invalid ? "error" : !result ? "pending" : result.status === "error" ? "error" : "success";
  return <button className={`context-tool ${state}`} onClick={() => onOpen({ kind: "call", call, result })} title="View arguments and full result">
    <span className="context-tool-head"><code>{call.name}</code><span className={`context-status ${state}`}>{state === "pending" ? "Pending" : state === "error" ? "Failed" : "Complete"}</span></span>
    {result && <pre className="context-tool-result">{result.content.slice(0, 1500)}</pre>}
  </button>;
}
