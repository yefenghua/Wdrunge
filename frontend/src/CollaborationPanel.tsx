import { useEffect, useState } from 'react';
import MessageContent from './MessageContent';
import GoalPanel, { AcceptanceForm, type Goal } from './GoalPanel';
import EnvironmentPanel from './EnvironmentPanel';
import { memberName } from './TeamIdentity';
import './CollaborationPanel.css';

const base = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:17420';
type Doc = { id: string; title: string; path: string; version: number };
type Job = { goal_id?: string; acceptance_criteria?: string[]; id: string; summary?: string; conversation?: string; sender: string; recipient: string; goal: string; state: string; result: string; dependencies: string[]; delivered: string[]; priority?: number; deadline?: number; escalated_at?: number; blocked_reason?: string; instance_id?: string; workspace_id?: string; needs_review?: boolean; findings?: { kind: string; path: string; line: number; message: string; severity: string }[] };
type Decision = { id: string; title: string; rationale: string; state: string; version: number };
type Journal = { request: string; attempts: { attempt: number; mode?: string; outcome?: string; reason?: string }[]; last_failure?: { tool: string; code?: string; error: string } | null; notes: { kind: string; text: string; attempt?: number }[]; facts: string };
const outcomeLabels: Record<string, string> = { delivered: 'Delivered', failed: 'Failed', interrupted: 'Auto-resumed after interruption', cancelled: 'Canceled', suspended: 'On hold', conflict: 'Delivery conflict', ended: 'Ended without delivery' };
type Snapshot = { journal?: Journal[]; goal?: Goal[]; settings?: {paused:boolean}[]; decision?: Decision[]; handoff?: {id: string; created: number; summary: string}[]; document: Doc[]; request: Job[]; message: { id: string; sender: string; recipient: string; content: string; summary?: string; conversation?: string }[] };

type Heading = { id: string; title: string; level: number; characters: number };

export default function CollaborationPanel({ project, conversation, onOpen }: { project: string; conversation: string; onOpen: (path: string) => void }) {
  const [data, setData] = useState<Snapshot>({ document: [], request: [], message: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [findings, setFindings] = useState<{kind: string; document_id?: string; decision_id?: string; fact?: string}[]>([]);
  const [checked, setChecked] = useState(false);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [content, setContent] = useState('');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<{document_id: string; version: number; section_id: string; title: string; excerpt: string}[]>([]);
  const [section, setSection] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [outlineOffset, setOutlineOffset] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<{version:number;summary:string;author:string;created:number}[]>([]);
  const [historyOffset, setHistoryOffset] = useState<number|null>(null);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const url = `${base}/api/projects/${encodeURIComponent(project)}/collaboration`;
  async function command(action: string, payload: object) {
    const response = await fetch(`${url}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload, conversation }) });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Action failed');
    return body;
  }
  async function stopService(name: string) {
    const response = await fetch(`${url}/services/${encodeURIComponent(name)}/stop`, { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not stop the service');
    return body;
  }
  async function refresh(signal?: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Could not load collaboration records');
    setData(await response.json());
  }
  useEffect(() => {
    const controller = new AbortController();
    const load = () => void refresh(controller.signal).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    load(); const timer = setInterval(load, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [project]);
  async function act(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); await refresh(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  const labels: Record<string, string> = { queued: 'Queued', running: 'Running', blocked: 'Blocked', review: 'In review', completed: 'Completed', cancelled: 'Canceled', rejected: 'Rejected', failed: 'Failed' };
  const requests = data.request.filter(r => !r.conversation || r.conversation === conversation);
  const messages = data.message.filter(m => !m.conversation || m.conversation === conversation);
  const paused = data.settings?.some(s => s.paused) || false;
  return <section className="collaboration-panel chat-collaboration" aria-label="Tasks and collaboration">
    <header className="collaboration-hero"><div><span className="collaboration-hero-icon" aria-hidden="true">◇</span><div><strong>Tasks &amp; collaboration</strong><small>Tasks {requests.length} · Goals {(data.goal || []).filter(g => g.conversation === conversation).length}</small></div></div><span className={`collaboration-schedule-state ${paused ? 'paused' : ''}`}><i />{paused ? 'Paused' : 'Auto schedule'}</span></header>
    {error && <p role="alert">{error}</p>}
    <div className="collaboration-controls collaboration-schedule-controls" role="group" aria-label="Task scheduling">
      <button disabled={busy || paused} onClick={() => void act(async () => { const r = await fetch(`${url}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"paused":true}' }); if (!r.ok) throw new Error('Could not pause scheduling'); })}><span aria-hidden="true">Ⅱ</span> Pause</button>
      <button disabled={busy || !paused} onClick={() => void act(async () => { const r = await fetch(`${url}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"paused":false}' }); if (!r.ok) throw new Error('Could not resume scheduling'); })}><span aria-hidden="true">▶</span> Resume</button>
    </div>
    <GoalPanel goals={(data.goal || []).filter(g => g.conversation === conversation)} tasks={requests} busy={busy} command={command} act={act} />
    <h3>Requests <span>{requests.length}</span></h3>
    {!requests.length && <p className="collaboration-empty">No requests yet.</p>}
    {[...requests].reverse().map(r => <article className={`collaboration-request state-${r.state}`} key={r.id} id={`request-${r.id}`}><div><strong>{memberName(r.sender)} <i aria-hidden="true">→</i> {memberName(r.recipient)}</strong><span>{labels[r.state] || r.state}</span></div><p>{r.summary || "Collaboration task"}</p><details className="collaboration-details"><summary>Task details &amp; delivery</summary><p>{r.goal}</p>{r.result && <MessageContent message={{ id: r.id, sender: r.recipient, content: r.result }} />}</details>{(() => { const j = data.journal?.find(item => item.request === r.id); return j && (j.attempts.length > 0 || j.notes.length > 0 || j.facts) ? <details className="collaboration-details"><summary>Work log · {j.attempts.length} {j.attempts.length === 1 ? 'run' : 'runs'}</summary>
      {j.attempts.map(a => <p key={a.attempt + (a.mode || '')}>Run {a.attempt} · {a.mode === 'continue' ? 'Resumed' : 'Fresh context'} · {outcomeLabels[a.outcome || ''] || a.outcome || 'In progress'}{a.reason ? ` — ${a.reason}` : ''}</p>)}
      {j.last_failure && <p role="status">Last tool failure — {j.last_failure.tool} [{j.last_failure.code || 'error'}] {j.last_failure.error}</p>}
      {j.notes.map((n, i) => <p key={i}><strong>[{n.kind}]</strong> {n.text}</p>)}
      {j.facts && <pre className="journal-facts">{j.facts}</pre>}
      <a className="collaboration-document" href={`${url}/requests/${encodeURIComponent(r.id)}/journal`} download>Export work log (Markdown)</a>
    </details> : null; })()}<div className="collaboration-controls"><label>Priority <select aria-label={`Priority for request ${r.id}`} value={r.priority ?? 1} disabled={busy || ['completed','cancelled','rejected','failed'].includes(r.state)} onChange={e => void act(async () => { await command('schedule', { identifier: r.id, priority: Number(e.target.value) }); })}><option value={0}>Low</option><option value={1}>Normal</option><option value={2}>High</option><option value={3}>Urgent</option></select></label>{r.deadline && <small>Due {new Date(r.deadline * 1000).toLocaleString('en-GB')}{r.escalated_at ? ' · Escalated after deadline' : ''}</small>}</div>{r.needs_review && <p role="status">Task references changed. Review them again.</p>}{r.findings && r.findings.length > 0 && <details className="collaboration-details"><summary>Delivery checks · {r.findings.length} to review</summary>{r.findings.map((f, i) => <p key={i}><strong>[{({ high: 'High', medium: 'Medium', low: 'Low' } as Record<string, string>)[f.severity] || f.severity}] {({ platform_leak: 'Platform details exposed', port_mismatch: 'Port differs from project settings', evidence_in_contract: 'Test records in contract', oversized: 'Delivery exceeds scope', generated_without_command: 'Missing command to regenerate file' } as Record<string, string>)[f.kind] || f.kind}</strong> {f.path}{f.line ? `:${f.line}` : ''} — {f.message}</p>)}</details>}{r.blocked_reason && <p role="status">Blocked — {{basis_changed:'Task references changed and need review',merge_conflict:'Changes conflict. The separate workspace is intact.',dependency_failed:'A dependency failed'}[r.blocked_reason] || r.blocked_reason}</p>}{r.dependencies.length > 0 && <div className="collaboration-dependencies">Depends on {r.dependencies.map(id => <a href={`#request-${id}`} key={id}>{memberName(data.request.find(job => job.id === id)?.recipient || 'leader')} · {labels[data.request.find(job => job.id === id)?.state || ''] || 'Unknown'}</a>)}</div>}{r.delivered.map(path => <button className="collaboration-document" key={path} onClick={() => onOpen(path)}>{path} ↗</button>)}<footer>{r.state === 'failed' && <button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'queued', result: 'User retried the original task. Continue checking the retained workspace and complete delivery.' }); })}>Retry task</button>}{r.state === 'blocked' && <button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'queued', result: 'Review the task references and conflicts before resuming. Keep the existing work.' }); })}>Review &amp; requeue</button>}{r.state === 'review' && <>{r.goal_id ? <details><summary>Review each criterion</summary><AcceptanceForm criteria={r.acceptance_criteria || []} busy={busy} onAccept={evidence => void act(async () => { await command('complete_task', { identifier: r.id, result: 'User approved each acceptance criterion', evidence }); })} /></details> : <button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'completed', result: 'User confirmed approval' }); })}>Approve</button>}<button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'queued', result: 'Review the delivery requirements and rework the task' }); })}>Request changes</button></>}{!['completed', 'cancelled', 'rejected', 'failed'].includes(r.state) && <button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'cancelled', result: 'Canceled by user' }); })}>Cancel</button>}</footer></article>)}
    <h3>Collaboration log</h3>
    {!messages.length && <p className="collaboration-empty">No collaboration entries yet. Mentions and replies appear in chat.</p>}
    {messages.map(m => <article className="collaboration-request" key={m.id}><strong>{memberName(m.sender)} → {memberName(m.recipient)}</strong><p>{m.summary || 'Collaboration message'}</p><details className="collaboration-details"><summary>View details</summary><MessageContent message={{ id: m.id, sender: m.sender, content: m.content }} /></details></article>)}
    <details className="collaboration-project-records" onToggle={e => setEnvironmentOpen((e.target as HTMLDetailsElement).open)}><summary>Project environment (ports, URLs, commands)</summary>
      {environmentOpen && <EnvironmentPanel busy={busy} command={command} stopService={stopService} act={act} />}
    </details>
    <details className="collaboration-project-records"><summary>Project records &amp; maintenance</summary>
    <h3>Documents &amp; revisions</h3>
    <form className="collaboration-controls" onSubmit={e => { e.preventDefault(); void act(async () => { const r = await command('search', { query }); setMatches(r.matches); }); }}><input aria-label="Search documents" placeholder="Search document contents" value={query} onChange={e => setQuery(e.target.value)} /><button disabled={busy || !query.trim()}>Search</button></form>
    {matches.map((m, i) => <button className="collaboration-document" key={i} onClick={() => void act(async () => { const d = data.document.find(d => d.id === m.document_id); if (d) { setDoc({...d, version: m.version}); const r = await command('read', { document_id: d.id, version: m.version, section_id: m.section_id }); setSection(m.section_id); setContent(r.content); setNextOffset(r.next_offset); setHeadings([]); setOutlineOffset(null); } })}>{m.title}<small>{m.excerpt}</small></button>)}
    {!data.document.length && <p className="collaboration-empty">No shared documents yet.</p>}
    {data.document.map(d => <button className="collaboration-document" key={d.id} disabled={busy} onClick={() => void act(async () => { const r = await command('read', { document_id: d.id, version: d.version }); setDoc(d); setRevisions([]); setHistoryOffset(null); setHeadings(r.outline); setOutlineOffset(r.next_offset); setContent(''); setSection(null); setNextOffset(null); })}>{d.title}<small>v{d.version} · {d.path}</small></button>)}
    {doc && <div className="collaboration-reader"><strong>{doc.title} · v{doc.version}</strong><button disabled={busy} onClick={() => void act(async () => { const r = await command('history', { document_id: doc.id }); setRevisions(r.revisions); setHistoryOffset(r.next_offset); })}>Revision history</button>{revisions.map(v => <button key={v.version} onClick={() => void act(async () => { const r = await command('read', { document_id: doc.id, version: v.version }); setDoc({...doc,version:v.version}); setHeadings(r.outline); setOutlineOffset(r.next_offset); setContent(''); setSection(null); setNextOffset(null); })}>v{v.version} · {v.author} · {new Date(v.created*1000).toLocaleDateString('en-GB')}<small>{v.summary}</small></button>)}{historyOffset !== null && <button disabled={busy} onClick={() => void act(async () => { const r = await command('history', { document_id: doc.id, offset: historyOffset }); setRevisions([...revisions, ...r.revisions]); setHistoryOffset(r.next_offset); })}>Earlier revisions</button>}{headings.map(h => <button key={h.id} style={{ paddingLeft: `${8 + h.level * 10}px` }} onClick={() => void act(async () => { const r = await command('read', { document_id: doc.id, version: doc.version, section_id: h.id }); setContent(r.content); setSection(h.id); setNextOffset(r.next_offset); })}>{h.title} <small>{h.characters} chars</small></button>)}{outlineOffset !== null && <button disabled={busy} onClick={() => void act(async () => { const r = await command('read', { document_id: doc.id, version: doc.version, offset: outlineOffset }); setHeadings([...headings, ...r.outline]); setOutlineOffset(r.next_offset); })}>More sections</button>}<MessageContent message={{ id: "preview", sender: "leader", content }} />{nextOffset !== null && section && <button disabled={busy} onClick={() => void act(async () => { const r = await command('read', { document_id: doc.id, version: doc.version, section_id: section, offset: nextOffset }); setContent(content + r.content); setNextOffset(r.next_offset); })}>Read more</button>}{section && doc.version > 1 && <button disabled={busy} onClick={() => void act(async () => { const r = await command('diff', { document_id: doc.id, from_version: doc.version-1, to_version: doc.version, section_id: section }); setContent('```diff\n' + r.diff + '\n```'); setNextOffset(null); })}>Compare this section</button>}</div>}
    <h3>Maintenance &amp; decisions</h3>
    <div className="collaboration-controls"><button disabled={busy} onClick={() => void act(async () => { const r = await command('maintenance', {}); setFindings(r.findings); setChecked(true); })}>Check documents</button><button disabled={busy} onClick={() => void act(async () => { await command('handoff', { save: true, summary: 'User saved a project handoff' }); })}>Save handoff</button></div>
    {checked && <p className="collaboration-empty">{findings.length ? `${findings.length} to review` : 'Version, age, duplicate content, and decision checks passed.'}</p>}
    {findings.map((f, i) => <p key={i}>{{stale_dependency: 'Document references changed', review_due: 'Document due for review', duplicate_section: 'Duplicate section', decision_evidence_changed: 'Decision evidence changed', contradictory_decisions: 'Conflicting decisions'}[f.kind] || f.kind} · {data.document.find(d => d.id === f.document_id)?.title || f.fact || f.decision_id || 'Review related sections'}</p>)}
    {data.decision?.map(d => <article className="collaboration-request" key={d.id}><strong>{d.title}</strong><small> · v{d.version} · {{proposed:'Proposed',accepted:'Accepted',rejected:'Rejected',superseded:'Superseded'}[d.state] || d.state}</small><MessageContent message={{id:d.id,sender:'leader',content:d.rationale}} /></article>)}
    {data.handoff?.slice(-3).map(h => <p className="collaboration-empty" key={h.id}>Handoff · {new Date(h.created*1000).toLocaleString('en-GB')} · {h.summary || 'Project snapshot'}</p>)}
    </details>
  </section>;
}
