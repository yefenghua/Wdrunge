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
const outcomeLabels: Record<string, string> = { delivered: '已交付', failed: '失败', interrupted: '中断后自动续跑', cancelled: '已取消', suspended: '挂起等待', conflict: '交付冲突', ended: '结束未交付' };
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
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : '操作失败');
    return body;
  }
  async function stopService(name: string) {
    const response = await fetch(`${url}/services/${encodeURIComponent(name)}/stop`, { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : '停止服务失败');
    return body;
  }
  async function refresh(signal?: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('无法读取协作记录');
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
  const labels: Record<string, string> = { queued: '排队', running: '执行中', blocked: '等待依赖', review: '待验收', completed: '完成', cancelled: '取消', rejected: '拒绝', failed: '失败' };
  const requests = data.request.filter(r => !r.conversation || r.conversation === conversation);
  const messages = data.message.filter(m => !m.conversation || m.conversation === conversation);
  const paused = data.settings?.some(s => s.paused) || false;
  return <section className="collaboration-panel chat-collaboration" aria-label="群聊任务与协作">
    <header className="collaboration-hero"><div><span className="collaboration-hero-icon" aria-hidden="true">◇</span><div><strong>任务与协作</strong><small>{requests.length} 项任务 · {(data.goal || []).filter(g => g.conversation === conversation).length} 个长期目标</small></div></div><span className={`collaboration-schedule-state ${paused ? 'paused' : ''}`}><i />{paused ? '调度已暂停' : '自动调度中'}</span></header>
    {error && <p role="alert">{error}</p>}
    <div className="collaboration-controls collaboration-schedule-controls" role="group" aria-label="任务调度">
      <button disabled={busy || paused} onClick={() => void act(async () => { const r = await fetch(`${url}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"paused":true}' }); if (!r.ok) throw new Error('暂停失败'); })}><span aria-hidden="true">Ⅱ</span> 暂停</button>
      <button disabled={busy || !paused} onClick={() => void act(async () => { const r = await fetch(`${url}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"paused":false}' }); if (!r.ok) throw new Error('恢复失败'); })}><span aria-hidden="true">▶</span> 继续</button>
    </div>
    <GoalPanel goals={(data.goal || []).filter(g => g.conversation === conversation)} tasks={requests} busy={busy} command={command} act={act} />
    <h3>协作请求 <span>{requests.length}</span></h3>
    {!requests.length && <p className="collaboration-empty">暂无请求</p>}
    {[...requests].reverse().map(r => <article className={`collaboration-request state-${r.state}`} key={r.id} id={`request-${r.id}`}><div><strong>{memberName(r.sender)} <i aria-hidden="true">→</i> {memberName(r.recipient)}</strong><span>{labels[r.state] || r.state}</span></div><p>{r.summary || "协作任务"}</p><details className="collaboration-details"><summary>任务详情与交付说明</summary><p>{r.goal}</p>{r.result && <MessageContent message={{ id: r.id, sender: r.recipient, content: r.result }} />}</details>{(() => { const j = data.journal?.find(item => item.request === r.id); return j && (j.attempts.length > 0 || j.notes.length > 0 || j.facts) ? <details className="collaboration-details"><summary>工作记录（{j.attempts.length} 次执行）</summary>
      {j.attempts.map(a => <p key={a.attempt + (a.mode || '')}>第 {a.attempt} 次 · {a.mode === 'continue' ? '续跑' : '新上下文'} · {outcomeLabels[a.outcome || ''] || a.outcome || '进行中'}{a.reason ? `：${a.reason}` : ''}</p>)}
      {j.last_failure && <p role="status">最近工具失败：{j.last_failure.tool} [{j.last_failure.code || 'error'}] {j.last_failure.error}</p>}
      {j.notes.map((n, i) => <p key={i}><strong>[{n.kind}]</strong> {n.text}</p>)}
      {j.facts && <pre className="journal-facts">{j.facts}</pre>}
      <a className="collaboration-document" href={`${url}/requests/${encodeURIComponent(r.id)}/journal`} download>导出工作记录（Markdown）</a>
    </details> : null; })()}<div className="collaboration-controls"><label>优先级 <select aria-label={`请求 ${r.id} 优先级`} value={r.priority ?? 1} disabled={busy || ['completed','cancelled','rejected','failed'].includes(r.state)} onChange={e => void act(async () => { await command('schedule', { identifier: r.id, priority: Number(e.target.value) }); })}><option value={0}>低</option><option value={1}>普通</option><option value={2}>高</option><option value={3}>紧急</option></select></label>{r.deadline && <small>截止 {new Date(r.deadline * 1000).toLocaleString()}{r.escalated_at ? ' · 已超时升级' : ''}</small>}</div>{r.needs_review && <p role="status">任务依据已更新，需要重新核对。</p>}{r.findings && r.findings.length > 0 && <details className="collaboration-details"><summary>交付检查（{r.findings.length} 项待核对）</summary>{r.findings.map((f, i) => <p key={i}><strong>[{({ high: '高', medium: '中', low: '低' } as Record<string, string>)[f.severity] || f.severity}] {({ platform_leak: '平台信息泄漏', port_mismatch: '端口与项目环境不一致', evidence_in_contract: '契约中包含测试记录', oversized: '交付量超出规模', generated_without_command: '生成文件缺少重新生成命令' } as Record<string, string>)[f.kind] || f.kind}</strong> {f.path}{f.line ? `:${f.line}` : ''} — {f.message}</p>)}</details>}{r.blocked_reason && <p role="status">阻塞原因：{{basis_changed:'任务依据已变化，需要重新核对',merge_conflict:'修改冲突，已保留独立工作区',dependency_failed:'依赖任务未成功'}[r.blocked_reason] || r.blocked_reason}</p>}{r.dependencies.length > 0 && <div className="collaboration-dependencies">依赖：{r.dependencies.map(id => <a href={`#request-${id}`} key={id}>{memberName(data.request.find(job => job.id === id)?.recipient || 'leader')} · {labels[data.request.find(job => job.id === id)?.state || ''] || '未知'}</a>)}</div>}{r.delivered.map(path => <button className="collaboration-document" key={path} onClick={() => onOpen(path)}>{path} ↗</button>)}<footer>{r.state === 'failed' && <button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'queued', result: '用户重试原任务，继续检查保留的工作区并完成交付。' }); })}>重试原任务</button>}{r.state === 'blocked' && <button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'queued', result: '请重新核对任务依据和冲突后继续，保留已有工作。' }); })}>重新核对并排队</button>}{r.state === 'review' && <>{r.goal_id ? <details><summary>逐项验收</summary><AcceptanceForm criteria={r.acceptance_criteria || []} busy={busy} onAccept={evidence => void act(async () => { await command('complete_task', { identifier: r.id, result: '用户逐项验收通过', evidence }); })} /></details> : <button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'completed', result: '用户确认验收通过' }); })}>验收通过</button>}<button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'queued', result: '请检查交付要求并重新处理' }); })}>重新处理</button></>}{!['completed', 'cancelled', 'rejected', 'failed'].includes(r.state) && <button disabled={busy} onClick={() => void act(async () => { await command('transition', { identifier: r.id, state: 'cancelled', result: '用户取消' }); })}>取消</button>}</footer></article>)}
    <h3>群内协作详细记录</h3>
    {!messages.length && <p className="collaboration-empty">暂无协作记录，成员的 @ 摘要与回复会显示在群聊中。</p>}
    {messages.map(m => <article className="collaboration-request" key={m.id}><strong>{memberName(m.sender)} → {memberName(m.recipient)}</strong><p>{m.summary || '协作消息'}</p><details className="collaboration-details"><summary>查看详细记录</summary><MessageContent message={{ id: m.id, sender: m.sender, content: m.content }} /></details></article>)}
    <details className="collaboration-project-records" onToggle={e => setEnvironmentOpen((e.target as HTMLDetailsElement).open)}><summary>项目环境（端口、地址与命令）</summary>
      {environmentOpen && <EnvironmentPanel busy={busy} command={command} stopService={stopService} act={act} />}
    </details>
    <details className="collaboration-project-records"><summary>项目记录与文档维护</summary>
    <h3>已登记文档与修订历史</h3>
    <form className="collaboration-controls" onSubmit={e => { e.preventDefault(); void act(async () => { const r = await command('search', { query }); setMatches(r.matches); }); }}><input aria-label="搜索文档" placeholder="搜索文档内容" value={query} onChange={e => setQuery(e.target.value)} /><button disabled={busy || !query.trim()}>搜索</button></form>
    {matches.map((m, i) => <button className="collaboration-document" key={i} onClick={() => void act(async () => { const d = data.document.find(d => d.id === m.document_id); if (d) { setDoc({...d, version: m.version}); const r = await command('read', { document_id: d.id, version: m.version, section_id: m.section_id }); setSection(m.section_id); setContent(r.content); setNextOffset(r.next_offset); setHeadings([]); setOutlineOffset(null); } })}>{m.title}<small>{m.excerpt}</small></button>)}
    {!data.document.length && <p className="collaboration-empty">团队尚未登记共享文档</p>}
    {data.document.map(d => <button className="collaboration-document" key={d.id} disabled={busy} onClick={() => void act(async () => { const r = await command('read', { document_id: d.id, version: d.version }); setDoc(d); setRevisions([]); setHistoryOffset(null); setHeadings(r.outline); setOutlineOffset(r.next_offset); setContent(''); setSection(null); setNextOffset(null); })}>{d.title}<small>v{d.version} · {d.path}</small></button>)}
    {doc && <div className="collaboration-reader"><strong>{doc.title} · v{doc.version}</strong><button disabled={busy} onClick={() => void act(async () => { const r = await command('history', { document_id: doc.id }); setRevisions(r.revisions); setHistoryOffset(r.next_offset); })}>修订历史</button>{revisions.map(v => <button key={v.version} onClick={() => void act(async () => { const r = await command('read', { document_id: doc.id, version: v.version }); setDoc({...doc,version:v.version}); setHeadings(r.outline); setOutlineOffset(r.next_offset); setContent(''); setSection(null); setNextOffset(null); })}>v{v.version} · {v.author} · {new Date(v.created*1000).toLocaleDateString()}<small>{v.summary}</small></button>)}{historyOffset !== null && <button disabled={busy} onClick={() => void act(async () => { const r = await command('history', { document_id: doc.id, offset: historyOffset }); setRevisions([...revisions, ...r.revisions]); setHistoryOffset(r.next_offset); })}>更早修订</button>}{headings.map(h => <button key={h.id} style={{ paddingLeft: `${8 + h.level * 10}px` }} onClick={() => void act(async () => { const r = await command('read', { document_id: doc.id, version: doc.version, section_id: h.id }); setContent(r.content); setSection(h.id); setNextOffset(r.next_offset); })}>{h.title} <small>{h.characters} 字符</small></button>)}{outlineOffset !== null && <button disabled={busy} onClick={() => void act(async () => { const r = await command('read', { document_id: doc.id, version: doc.version, offset: outlineOffset }); setHeadings([...headings, ...r.outline]); setOutlineOffset(r.next_offset); })}>更多章节</button>}<MessageContent message={{ id: "preview", sender: "leader", content }} />{nextOffset !== null && section && <button disabled={busy} onClick={() => void act(async () => { const r = await command('read', { document_id: doc.id, version: doc.version, section_id: section, offset: nextOffset }); setContent(content + r.content); setNextOffset(r.next_offset); })}>继续读取</button>}{section && doc.version > 1 && <button disabled={busy} onClick={() => void act(async () => { const r = await command('diff', { document_id: doc.id, from_version: doc.version-1, to_version: doc.version, section_id: section }); setContent('```diff\n' + r.diff + '\n```'); setNextOffset(null); })}>查看本节上次变更</button>}</div>}
    <h3>文档维护与决策</h3>
    <div className="collaboration-controls"><button disabled={busy} onClick={() => void act(async () => { const r = await command('maintenance', {}); setFindings(r.findings); setChecked(true); })}>检查文档</button><button disabled={busy} onClick={() => void act(async () => { await command('handoff', { save: true, summary: '用户保存项目阶段交接' }); })}>保存阶段交接</button></div>
    {checked && <p className="collaboration-empty">{findings.length ? `${findings.length} 项需要核对` : '已检查版本、更新时间、重复正文和结构化决策，未发现问题。'}</p>}
    {findings.map((f, i) => <p key={i}>{{stale_dependency: '文档依据已变化', review_due: '文档较久未更新', duplicate_section: '发现重复章节', decision_evidence_changed: '决策依据已变化', contradictory_decisions: '决策约定冲突'}[f.kind] || f.kind} · {data.document.find(d => d.id === f.document_id)?.title || f.fact || f.decision_id || '请核对相关章节'}</p>)}
    {data.decision?.map(d => <article className="collaboration-request" key={d.id}><strong>{d.title}</strong><small> · v{d.version} · {{proposed:'提议',accepted:'已采纳',rejected:'已拒绝',superseded:'已替代'}[d.state] || d.state}</small><MessageContent message={{id:d.id,sender:'leader',content:d.rationale}} /></article>)}
    {data.handoff?.slice(-3).map(h => <p className="collaboration-empty" key={h.id}>交接记录 · {new Date(h.created*1000).toLocaleString()} · {h.summary || '项目状态快照'}</p>)}
    </details>
  </section>;
}
