import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import './ExecutionPermissions.css';
import { setControlToken as setToken, useControlToken } from './controlToken';

const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:17420').replace(/\/$/, '');
const STALE_AUTHORIZATION = 'Authorization expired. Reconnect to continue.';
type Permission = { id: string; scope: string; reason: string; agent: string | null; conversation: string | null; operation: Record<string, unknown> };
type ApprovalSettings = { allow_all?: boolean; ai_review: boolean; whitelist: ('versions' | 'git_status')[] };
type State = { pending: Permission[]; grants: Permission[]; sandbox: { available: boolean; detail: string; backend: string | null }; settings?: ApprovalSettings; reviewer?: { model: string; ready: boolean }; recent_auto_approvals?: number };
type Job = { id: string; name: string; cwd: string; state: string; exit_code: number | null };

export default function ExecutionPermissions() {
  const token = useControlToken();
  const [draft, setDraft] = useState('');
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mutationVersion = useRef(0);
  const mutating = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = state?.pending[0];
  const stale = error === STALE_AUTHORIZATION;
  useEffect(() => {
    if (isTauri()) invoke<string>('execution_control_token').then(setToken).catch(() => {});
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = mutationVersion.current;
      try {
        const capabilities = await fetch(`${base}/api/execution/capabilities`, { signal: abort.signal }).then(r => r.json());
        if (abort.signal.aborted) return;
        setPendingCount(capabilities.pending || 0);
        if (!token && isTauri()) {
          try { setToken(await invoke<string>('execution_control_token')); } catch { /* Retry on next poll. */ }
        }
        if (token) {
          const headers = { Authorization: `Bearer ${token}` };
          const response = await fetch(`${base}/api/execution/permissions`, { headers, signal: abort.signal });
          if (response.status === 401 && isTauri()) {
            // A restarted backend writes a new token file; reconnect without a click.
            try {
              const fresh = await invoke<string>('execution_control_token');
              if (fresh && fresh !== token) { setToken(fresh); return; }
            } catch { /* Report the stale connection below. */ }
          }
          if (!response.ok) throw new Error(response.status === 401 ? STALE_AUTHORIZATION : 'Could not load execution permissions');
          const data = await response.json() as State;
          const processes = await fetch(`${base}/api/execution/processes`, { headers, signal: abort.signal }).then(r => r.json());
          if (abort.signal.aborted) return;
          if (!mutating.current && version === mutationVersion.current) {
            setState(data); setJobs(processes.processes || []); setError('');
          }
        }
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Connection failed');
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 1500);
      }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [token]);
  useEffect(() => {
    const show = opened || !!pending || ((!token || stale) && pendingCount > 0);
    if (show && !dialog.current?.open) dialog.current?.showModal();
    if (!show && dialog.current?.open) dialog.current.close();
  }, [opened, pending, token, pendingCount, stale]);
  async function mutate(path: string, body?: unknown) {
    mutating.current = true; mutationVersion.current++;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${base}/api/execution/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (response.status === 401) throw new Error(STALE_AUTHORIZATION);
      if (!response.ok) { const data = await response.json(); throw new Error(data.detail || 'Operation failed'); }
      const responseState = await fetch(`${base}/api/execution/permissions`, { headers: { Authorization: `Bearer ${token}` } });
      if (responseState.ok) setState(await responseState.json());
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Operation failed'); return false; }
    finally { mutating.current = false; mutationVersion.current++; setBusy(false); }
  }
  async function configureSettings(settings: ApprovalSettings) {
    if (!state?.settings || mutating.current) return;
    const previous = state.settings;
    setState(current => current ? { ...current, settings } : current);
    if (!await mutate('settings', settings)) {
      setState(current => current ? { ...current, settings: previous } : current);
    }
  }
  function updateWhitelist(rule: 'versions' | 'git_status', enabled: boolean) {
    if (!state?.settings) return;
    const whitelist = enabled ? [...new Set([...state.settings.whitelist, rule])] : state.settings.whitelist.filter(item => item !== rule);
    void configureSettings({ ...state.settings, whitelist });
  }
  return <>
    <button className={`execution-trigger${state?.settings?.allow_all ? ' allow-all' : ''}`} onClick={() => setOpened(true)}>
      <span className="execution-trigger-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 2.5 16 5v4.2c0 3.9-2.4 6.8-6 8.3-3.6-1.5-6-4.4-6-8.3V5l6-2.5Z" /><path d="m7.5 10 1.7 1.7 3.5-4" /></svg></span>
      <span className="execution-trigger-copy"><strong>Execution permissions</strong><small>{state?.settings?.allow_all ? 'All actions allowed' : pendingCount > 0 ? `${pendingCount} pending` : 'Command access'}</small></span>
      {pendingCount > 0 && <span className="execution-trigger-badge" aria-hidden="true">{pendingCount}</span>}
    </button>
    <dialog ref={dialog} className="execution-dialog" onCancel={event => { if (pending) event.preventDefault(); else setOpened(false); }} aria-labelledby="execution-title">
      <header className="execution-dialog-heading">
        <span className="execution-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 20 6.2v5.4c0 5-3.2 8.7-8 10.4-4.8-1.7-8-5.4-8-10.4V6.2L12 3Z" /><path d="m8.8 12 2.1 2.1 4.5-5" /></svg></span>
        <div><small>Security</small><h2 id="execution-title">{pending ? 'Approval required' : 'Execution permissions and services'}</h2></div>
      </header>
      {(!token || stale) && <form className="execution-connect" onSubmit={async event => { event.preventDefault(); if (isTauri()) { try { setToken(await invoke<string>('execution_control_token')); } catch { setError('The backend is not ready. Make sure it is running.'); } } else setToken(draft.trim()); }}>
        <p className="execution-lead">Authorization is separate from agents, so they cannot approve their own commands.</p>
        {!isTauri() && <><p>Copy the token from Wdrunge/execution-token in your local application data. On macOS, this is under ~/Library/Application Support/Wdrunge/.</p><label className="execution-field"><span>Local authorization token</span><input type="password" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Paste the local authorization token" /></label></>}
        <button className="execution-primary" type="submit">Connect</button>
      </form>}
      {state && <p className="sandbox-status">{state.sandbox.backend || 'Sandbox unavailable'} · {state.sandbox.detail}</p>}
      {state?.settings && <details className="approval-settings">
        <summary>Automatic approvals and allowlist</summary>
        <label className="allow-all-option"><input type="checkbox" checked={!!state.settings.allow_all} disabled={busy} onChange={event => {
          if (event.target.checked && !window.confirm('Allow all commands, network access, external file reads, and file moves without approval? Pending actions will also be allowed. Sandbox isolation and credential protection remain in effect.')) return;
          void configureSettings({ ...state.settings!, allow_all: event.target.checked });
        }} /><span>Allow all actions<small>Skips manual approval and model review. Sandbox isolation and credential protection stay in effect. You can turn this off at any time.</small></span></label>
        <label><input type="checkbox" checked={state.settings.ai_review} disabled={busy} onChange={event => void configureSettings({ ...state.settings!, ai_review: event.target.checked })} /><span>Model-based approval<small>Auto-approves requests endorsed by {state.reviewer?.model || 'the review model'} with at least 75% confidence. Other requests need your approval.</small></span></label>
        {state.settings.ai_review && state.reviewer?.ready === false && <p role="status">The review model is not configured. Actions outside the allowlist require manual approval.</p>}
        <label><input type="checkbox" checked={state.settings.whitelist.includes('versions')} disabled={busy} onChange={event => updateWhitelist('versions', event.target.checked)} /><span>Allow version checks<small>Allow --version checks for Python, Node, npm, Git, and similar tools.</small></span></label>
        <label><input type="checkbox" checked={state.settings.whitelist.includes('git_status')} disabled={busy} onChange={event => updateWhitelist('git_status', event.target.checked)} /><span>Allow Git status checks<small>Allows git status and its common short formats. Excludes commits, resets, and deletions.</small></span></label>
        <p>The allowlist matches exact commands and arguments. It applies within the project, with no network access or extra read permissions. Use “Always allow” to add an action for this project.</p>
        {!!state.recent_auto_approvals && <small>Recent automatic approvals: {state.recent_auto_approvals}</small>}
      </details>}
      {pending && <section>
        <p>{pending.agent ? `${pending.agent}: ` : ''}{pending.reason}</p>
        <p>Project: {pending.scope}</p>
        <pre>{JSON.stringify(pending.operation, null, 2)}</pre>
        <p>“Always allow” applies to this project and the same action, arguments, directory, and permission scope. You can revoke it below. The sandbox stays in effect.</p>
        <div className="execution-actions">
          <button disabled={busy} onClick={() => void mutate(`permissions/${pending.id}`, { decision: 'deny' })}>Deny</button>
          <button disabled={busy} onClick={() => void mutate(`permissions/${pending.id}`, { decision: 'once' })}>Allow once</button>
          <button disabled={busy} onClick={() => void mutate(`permissions/${pending.id}`, { decision: 'always' })}>Always allow</button>
        </div>
      </section>}
      {!pending && state && !stale && <p>No pending approvals.</p>}
      {stale && pendingCount > 0 && <p role="status">Reconnect to review pending actions ({pendingCount}).</p>}
      {!!state?.grants.length && <details><summary>Saved approvals ({state.grants.length})</summary><p>Matching actions are allowed automatically for this project.</p>{state.grants.map(grant => <section key={grant.id}><p>{grant.scope}</p><pre>{JSON.stringify(grant.operation, null, 2)}</pre><button disabled={busy} onClick={() => void mutate(`grants/${grant.id}/revoke`)}>Revoke approval</button></section>)}</details>}
      {!!jobs.length && <details><summary>Task processes ({jobs.length})</summary>{jobs.map(job => <section key={job.id}><p>{job.name} · {job.state} {job.exit_code !== null ? `(${job.exit_code})` : ''}</p><small>{job.cwd}</small>{job.state === 'running' && <button disabled={busy} onClick={() => void mutate(`processes/${job.id}/stop`)}>Stop service</button>}</section>)}</details>}
      {error && <p className="execution-error" role="alert">{error}</p>}
      {!pending && <button className="execution-close" onClick={() => setOpened(false)}>Close</button>}
    </dialog>
  </>;
}
