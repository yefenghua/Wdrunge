import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import './ExecutionPermissions.css';
import { setControlToken as setToken, useControlToken } from './controlToken';

const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:17420').replace(/\/$/, '');
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
          if (!response.ok) throw new Error(response.status === 401 ? '授权连接已失效，请重新连接。' : '无法读取执行权限');
          const data = await response.json() as State;
          const processes = await fetch(`${base}/api/execution/processes`, { headers, signal: abort.signal }).then(r => r.json());
          if (abort.signal.aborted) return;
          if (!mutating.current && version === mutationVersion.current) {
            setState(data); setJobs(processes.processes || []); setError('');
          }
        }
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '连接失败');
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 1500);
      }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [token]);
  useEffect(() => {
    const stale = error.includes('失效');
    const show = opened || !!pending || ((!token || stale) && pendingCount > 0);
    if (show && !dialog.current?.open) dialog.current?.showModal();
    if (!show && dialog.current?.open) dialog.current.close();
  }, [opened, pending, token, pendingCount, error]);
  async function mutate(path: string, body?: unknown) {
    mutating.current = true; mutationVersion.current++;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${base}/api/execution/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) { const data = await response.json(); throw new Error(data.detail || '操作失败'); }
      const responseState = await fetch(`${base}/api/execution/permissions`, { headers: { Authorization: `Bearer ${token}` } });
      if (responseState.ok) setState(await responseState.json());
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); return false; }
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
      <span className="execution-trigger-copy"><strong>执行权限</strong><small>{state?.settings?.allow_all ? '当前允许全部操作' : pendingCount > 0 ? `${pendingCount} 个操作待确认` : '管理命令与服务'}</small></span>
      {pendingCount > 0 && <span className="execution-trigger-badge" aria-hidden="true">{pendingCount}</span>}
    </button>
    <dialog ref={dialog} className="execution-dialog" onCancel={event => { if (pending) event.preventDefault(); else setOpened(false); }} aria-labelledby="execution-title">
      <header className="execution-dialog-heading">
        <span className="execution-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 20 6.2v5.4c0 5-3.2 8.7-8 10.4-4.8-1.7-8-5.4-8-10.4V6.2L12 3Z" /><path d="m8.8 12 2.1 2.1 4.5-5" /></svg></span>
        <div><small>安全控制</small><h2 id="execution-title">{pending ? '需要你允许这次操作' : '执行权限与服务'}</h2></div>
      </header>
      {(!token || error.includes('失效')) && <form className="execution-connect" onSubmit={async event => { event.preventDefault(); if (isTauri()) { try { setToken(await invoke<string>('execution_control_token')); } catch { setError('后端尚未准备好，请确认服务已启动。'); } } else setToken(draft.trim()); }}>
        <p className="execution-lead">授权通道与 Agent 分开，防止命令替自己点击允许。</p>
        {!isTauri() && <><p>请从本机应用数据目录的 Wdrunge/execution-token 文件复制授权码。macOS 位于 ~/Library/Application Support/Wdrunge/。</p><label className="execution-field"><span>本机授权码</span><input type="password" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value)} placeholder="粘贴本机授权码" /></label></>}
        <button className="execution-primary" type="submit">连接执行授权</button>
      </form>}
      {state && <p className="sandbox-status">{state.sandbox.backend || '沙箱不可用'} · {state.sandbox.detail}</p>}
      {state?.settings && <details className="approval-settings">
        <summary>自动审批与白名单</summary>
        <label className="allow-all-option"><input type="checkbox" checked={!!state.settings.allow_all} disabled={busy} onChange={event => {
          if (event.target.checked && !window.confirm('开启后，所有命令、联网、外部文件读取和文件移动都不再询问你，等待中的操作也会直接放行。沙箱隔离和凭据保护仍然有效。确定开启？')) return;
          void configureSettings({ ...state.settings!, allow_all: event.target.checked });
        }} /><span>允许所有操作<small>跳过全部人工确认（含小模型审核），适合你信任当前任务时使用；沙箱隔离与凭据保护不受影响，可随时关闭。</small></span></label>
        <label><input type="checkbox" checked={state.settings.ai_review} disabled={busy} onChange={event => void configureSettings({ ...state.settings!, ai_review: event.target.checked })} /><span>小模型自动审批<small>{state.reviewer?.model || '小模型'} 明确同意且置信度 ≥ 75% 时放行，拿不准时由你确认。</small></span></label>
        {state.settings.ai_review && state.reviewer?.ready === false && <p role="status">审核模型尚未配置，非白名单操作会转人工审批。</p>}
        <label><input type="checkbox" checked={state.settings.whitelist.includes('versions')} disabled={busy} onChange={event => updateWhitelist('versions', event.target.checked)} /><span>版本查询免审批<small>Python、Node、npm、Git 等工具的 --version。</small></span></label>
        <label><input type="checkbox" checked={state.settings.whitelist.includes('git_status')} disabled={busy} onChange={event => updateWhitelist('git_status', event.target.checked)} /><span>Git 状态查看免审批<small>git status 及常用简短输出；不包含提交、重置或删除。</small></span></label>
        <p>白名单只匹配完整命令和参数，限定项目内、不联网、没有额外读取范围。其他具体操作可通过“以后都允许”加入当前项目的白名单。</p>
        {!!state.recent_auto_approvals && <small>近期已有 {state.recent_auto_approvals} 次操作自动通过。</small>}
      </details>}
      {pending && <section>
        <p>{pending.agent ? `${pending.agent}：` : ''}{pending.reason}</p>
        <p>项目：{pending.scope}</p>
        <pre>{JSON.stringify(pending.operation, null, 2)}</pre>
        <p>“以后都允许”仅保存当前项目下相同操作、参数、目录和权限范围，可在下方撤销。授权不绕过沙箱。</p>
        <div className="execution-actions">
          <button disabled={busy} onClick={() => void mutate(`permissions/${pending.id}`, { decision: 'deny' })}>拒绝</button>
          <button disabled={busy} onClick={() => void mutate(`permissions/${pending.id}`, { decision: 'once' })}>单次允许</button>
          <button disabled={busy} onClick={() => void mutate(`permissions/${pending.id}`, { decision: 'always' })}>以后都允许</button>
        </div>
      </section>}
      {!pending && state && !error.includes('失效') && <p>当前没有待确认操作。</p>}
      {error.includes('失效') && pendingCount > 0 && <p role="status">有 {pendingCount} 个操作等待确认，但授权连接已失效，重新连接后才能查看和处理。</p>}
      {!!state?.grants.length && <details><summary>已保存的授权（{state.grants.length}）</summary><p>这些具体操作已加入项目白名单，下次匹配时免审批。</p>{state.grants.map(grant => <section key={grant.id}><p>{grant.scope}</p><pre>{JSON.stringify(grant.operation, null, 2)}</pre><button disabled={busy} onClick={() => void mutate(`grants/${grant.id}/revoke`)}>撤销授权</button></section>)}</details>}
      {!!jobs.length && <details><summary>任务进程（{jobs.length}）</summary>{jobs.map(job => <section key={job.id}><p>{job.name} · {job.state} {job.exit_code !== null ? `(${job.exit_code})` : ''}</p><small>{job.cwd}</small>{job.state === 'running' && <button disabled={busy} onClick={() => void mutate(`processes/${job.id}/stop`)}>停止服务</button>}</section>)}</details>}
      {error && <p className="execution-error" role="alert">{error}</p>}
      {!pending && <button className="execution-close" onClick={() => setOpened(false)}>关闭</button>}
    </dialog>
  </>;
}
