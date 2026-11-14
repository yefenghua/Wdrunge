import { useEffect, useState } from 'react';

type Service = {
  name: string; kind: string; port?: number; host?: string; base_url?: string; status?: string; source?: string;
  claimed?: boolean; owner?: string; note?: string; command?: { argv: string[]; cwd: string }; runtime?: Runtime;
};
type Runtime = { state: 'running' | 'restarting' | 'listening' | 'stopped'; process_id?: string; kept?: boolean; started_by?: string; stale?: string[]; note?: string };
type ProjectCommand = { name: string; argv: string[]; cwd: string; status: string; purpose?: string };
type Environment = { host: { os: string; userland: string }; reserved_ports: number[]; services: Service[]; commands: ProjectCommand[] };

const statusLabel: Record<string, string> = { verified: 'Verified', declared: 'Registered' };
const sourceLabel: Record<string, string> = { user: 'User', agent: 'Agent', manifest: 'Project config', observed: 'Detected at runtime' };

function runtimeLabel(runtime?: Runtime) {
  if (!runtime || runtime.state === 'stopped') return 'Stopped';
  if (runtime.state === 'listening') return 'Listening (started externally)';
  if (runtime.state === 'restarting') return 'Restarting from project root';
  return `Running${runtime.started_by ? ` (started by ${runtime.started_by}${runtime.kept ? ', kept after the task ends' : ''})` : ''}`
    + (runtime.stale?.length ? ` · Code changed, restart needed: ${runtime.stale.slice(0, 3).join(', ')}` : '');
}

export default function EnvironmentPanel({ busy, command, stopService, act }: {
  busy: boolean;
  command: (action: string, payload: object) => Promise<any>;
  stopService: (name: string) => Promise<any>;
  act: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [data, setData] = useState<Environment | null>(null);
  const [name, setName] = useState('');
  const [port, setPort] = useState('');
  const [start, setStart] = useState('');
  const [cwd, setCwd] = useState('.');
  const load = async () => {
    const result = await command('environment', {});
    setData(result && result.host && Array.isArray(result.services) && Array.isArray(result.commands) ? result : null);
  };
  useEffect(() => { void load().catch(() => setData(null)); }, []);
  const save = () => void act(async () => {
    await command('register_service', {
      name: name.trim(), ...(port.trim() ? { port: Number(port) } : {}),
      ...(start.trim() ? { argv: start.trim().split(/\s+/), cwd: cwd.trim() || '.' } : {}),
    });
    setName(''); setPort(''); setStart(''); setCwd('.');
    await load();
  });
  return <section aria-label="Project environment" className="environment-panel">
    <h3>Project environment</h3>
    <p className="collaboration-empty">Agents use the ports, addresses, and start commands listed here. Command review treats registered ports as project services.</p>
    {data && <>
      <p className="collaboration-empty">Host: {data.host.os} ({data.host.userland}) · Reserved ports: {data.reserved_ports.join(', ') || 'Not detected yet'}</p>
      {!data.services.length && <p className="collaboration-empty">No services registered.</p>}
      {data.services.map(s => <article className="collaboration-request" key={s.name}>
        <div><strong>{s.name}</strong><span>{runtimeLabel(s.runtime)} · {statusLabel[s.status || ''] || s.status}{s.claimed ? '' : ' · Port ownership unconfirmed'}</span></div>
        <p>{s.base_url || (s.port ? `${s.kind === 'http' ? 'http://' : ''}${s.host || '127.0.0.1'}:${s.port}` : 'No port assigned')}
          <small> · Source: {sourceLabel[s.source || ''] || s.source}{s.owner ? ` · ${s.owner}` : ''}</small></p>
        {s.command && <p><code>{s.command.argv.join(' ')}</code><small> (Directory: {s.command.cwd})</small></p>}
        {s.note && <small>{s.note}</small>}
        <div className="collaboration-controls">
          {s.runtime?.state === 'running' && <button disabled={busy} onClick={() => void act(async () => {
            await stopService(s.name); await load();
          })}>Stop</button>}
          <button disabled={busy} onClick={() => void act(async () => {
            await command('register_service', { name: s.name, remove: true }); await load();
          })}>Remove</button></div>
      </article>)}
      {data.commands.length > 0 && <><h3>Project commands</h3>{data.commands.map(c => <p key={c.name}>
        <strong>{c.name}</strong> <code>{c.argv.join(' ')}</code><small> (Directory: {c.cwd} · {statusLabel[c.status] || c.status})</small></p>)}</>}
    </>}
    <details><summary>Add or edit a service</summary>
      <form className="goal-evidence" onSubmit={e => { e.preventDefault(); save(); }}>
        <label>Service name (e.g. api, web, db)<input required pattern="[a-z0-9][a-z0-9_.\-]{0,39}" value={name} onChange={e => setName(e.target.value)} /></label>
        <label>Port (leave blank to assign one)<input inputMode="numeric" pattern="\d{1,5}" value={port} onChange={e => setPort(e.target.value)} /></label>
        <label>Start command (optional)<input value={start} onChange={e => setStart(e.target.value)} placeholder="python3 backend/app.py" /></label>
        <label>Working directory<input value={cwd} onChange={e => setCwd(e.target.value)} /></label>
        <button disabled={busy || !name.trim()}>Save</button>
      </form>
    </details>
  </section>;
}
