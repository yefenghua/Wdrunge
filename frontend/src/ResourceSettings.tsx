import { useEffect, useMemo, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ProjectSummary } from './api';
import { setControlToken, useControlToken } from './controlToken';
import './ResourceSettings.css';

const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:17420').replace(/\/$/, '');

type Extra = { key: string; value: string; secret: boolean; has_value?: boolean };
type Connection = {
  id: string; name: string; label: string; type: string; type_label: string; host: string; port: number | null;
  username: string; database: string; scheme: string; env_prefix: string; provision: boolean; can_provision: boolean;
  projects: string[] | null; extra: Extra[]; note: string; has_password: boolean; source: { kind: string; container?: string; image?: string };
};
type TypeInfo = { type: string; label: string; port: number | null; can_provision: boolean };
type Container = { container_id: string; container: string; image: string; type: string; type_label: string; port: number | null; username: string; has_password: boolean; imported: boolean; known_type: boolean };
type Test = { ok: boolean; detail: string };
type Backup = { name: string; engine: string; size: number; created: number };
type ProjectStatus = { project_id: string; data_dir: string; database: string; backups: Backup[];
  resources: { id: string; name: string; label: string; type: string; state: string; error?: string; own_database: boolean; database?: string; user?: string }[] };
type Draft = {
  id?: string; type: string; customType: string; name: string; label: string; host: string; port: string; username: string;
  password: string; clearPassword: boolean; hasPassword: boolean; database: string; scheme: string; envPrefix: string;
  provision: boolean; allProjects: boolean; projects: string[]; extra: Extra[]; note: string;
};

const RELATIONAL = new Set(['mysql', 'mariadb', 'postgresql']);
const CUSTOM = '__custom__';

function emptyDraft(type = 'mysql', types: TypeInfo[] = []): Draft {
  return { type, customType: '', name: type, label: '', host: '127.0.0.1', port: String(types.find(t => t.type === type)?.port ?? ''),
    username: type === 'mysql' || type === 'mariadb' ? 'root' : '', password: '', clearPassword: false, hasPassword: false,
    database: '', scheme: '', envPrefix: '', provision: true, allProjects: true, projects: [], extra: [], note: '' };
}

function fromConnection(connection: Connection, types: TypeInfo[]): Draft {
  const known = types.some(t => t.type === connection.type);
  return { id: connection.id, type: known ? connection.type : CUSTOM, customType: known ? '' : connection.type, name: connection.name,
    label: connection.label, host: connection.host, port: connection.port ? String(connection.port) : '', username: connection.username,
    password: '', clearPassword: false, hasPassword: connection.has_password, database: connection.database, scheme: connection.scheme,
    envPrefix: connection.env_prefix === defaultPrefix(connection.name) ? '' : connection.env_prefix, provision: connection.provision,
    allProjects: connection.projects === null, projects: connection.projects || [], extra: connection.extra.map(e => ({ ...e })), note: connection.note };
}

function defaultPrefix(name: string) {
  const prefix = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return prefix && /^[A-Z]/.test(prefix) ? prefix : `SVC_${prefix}`;
}

function draftType(draft: Draft) { return draft.type === CUSTOM ? draft.customType.trim().toLowerCase() : draft.type; }

function payload(draft: Draft) {
  return { name: draft.name.trim().toLowerCase(), label: draft.label.trim(), type: draftType(draft), host: draft.host.trim(),
    port: draft.port ? Number(draft.port) : null, username: draft.username, password: draft.password ? draft.password : null,
    clear_password: draft.clearPassword, database: draft.database, scheme: draft.scheme, env_prefix: draft.envPrefix,
    provision: draft.provision, projects: draft.allProjects ? null : draft.projects, note: draft.note,
    extra: draft.extra.filter(e => e.key.trim()).map(e => ({ key: e.key.trim().toUpperCase(), value: e.secret && !e.value ? null : e.value, secret: e.secret })) };
}

function errorText(data: any, status: number) {
  if (status === 401) return 'Authorization expired. Reconnect to continue.';
  if (typeof data?.detail === 'string') return data.detail;
  if (Array.isArray(data?.detail)) return data.detail.map((item: any) => String(item.msg || '').replace(/^Value error, /, '')).join(' · ');
  return `Request failed (${status})`;
}

export default function ResourceSettings({ projects, activeProject, onClose }: {
  projects: ProjectSummary[]; activeProject?: ProjectSummary; onClose: () => void;
}) {
  const token = useControlToken();
  const [draftToken, setDraftToken] = useState('');
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [types, setTypes] = useState<TypeInfo[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formTest, setFormTest] = useState<Test | null>(null);
  const [tests, setTests] = useState<Record<string, Test | 'running'>>({});
  const [docker, setDocker] = useState<{ containers: Container[]; unavailable?: string } | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${base}/api/resources${path}`, {
        method: init?.method || 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
        body: init?.body ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      // WebKit reports any network or CORS failure only as "Load failed".
      throw new Error('Could not reach the Wdrunge backend. Make sure it is running, and restart it after an update.');
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && isTauri()) {
      try { const fresh = await invoke<string>('execution_control_token'); if (fresh && fresh !== token) setControlToken(fresh); } catch { /* shown below */ }
    }
    if (!response.ok) throw new Error(errorText(data, response.status));
    return data as T;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Operation failed'); } finally { setBusy(false); }
  }

  async function load() {
    const data = await call<{ connections: Connection[]; types: TypeInfo[] }>('');
    setConnections(data.connections); setTypes(data.types);
    if (activeProject) setStatus(await call<ProjectStatus>(`/projects/${encodeURIComponent(activeProject.id)}`).catch(() => null));
  }

  useEffect(() => {
    if (!token && isTauri()) invoke<string>('execution_control_token').then(setControlToken).catch(() => {});
  }, [token]);
  useEffect(() => { if (token) void run(load); }, [token, activeProject?.id]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !draft) onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [draft, onClose]);

  const projectName = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const draftInfo = draft ? types.find(t => t.type === draftType(draft)) : undefined;
  const envPreview = draft ? (() => {
    const prefix = draft.envPrefix.trim().toUpperCase() || defaultPrefix(draft.name || 'service');
    const names = ['HOST', 'PORT', 'USER', 'PASSWORD', 'DATABASE', 'URL'].map(s => `${prefix}_${s}`);
    const extra = draft.extra.filter(e => e.key.trim()).map(e => e.key.trim().toUpperCase());
    return [...names, ...extra, ...(RELATIONAL.has(draftType(draft)) ? ['DATABASE_URL', 'DB_*'] : [])];
  })() : [];

  function update(patch: Partial<Draft>) { setDraft(current => current ? { ...current, ...patch } : current); setFormTest(null); }
  function chooseType(type: string) {
    if (!draft) return;
    const info = types.find(t => t.type === type);
    const renamed = !draft.id && (draft.name === draftType(draft) || !draft.name);
    update({ type, port: info?.port ? String(info.port) : draft.port, ...(renamed && type !== CUSTOM ? { name: type } : {}),
      ...(!draft.id && !draft.username && (type === 'mysql' || type === 'mariadb') ? { username: 'root' } : {}) });
  }

  async function save() {
    if (!draft) return;
    await run(async () => {
      await call(draft.id ? `/${draft.id}` : '', { method: draft.id ? 'PUT' : 'POST', body: payload(draft) });
      setDraft(null); setFormTest(null);
      await load();
    });
  }

  async function testDraft() {
    if (!draft) return;
    await run(async () => { setFormTest(await call<Test>('/test', { method: 'POST', body: { id: draft.id ?? null, connection: payload(draft) } })); });
  }

  async function testSaved(id: string) {
    setTests(current => ({ ...current, [id]: 'running' }));
    try { const result = await call<Test>('/test', { method: 'POST', body: { id } }); setTests(current => ({ ...current, [id]: result })); }
    catch (cause) { setTests(current => ({ ...current, [id]: { ok: false, detail: cause instanceof Error ? cause.message : 'Connection test failed' } })); }
  }

  async function openDocker() {
    await run(async () => { setDocker(await call<{ containers: Container[]; unavailable?: string }>('/docker')); });
  }

  async function importContainer(container: Container) {
    await run(async () => {
      const saved = await call<Connection & { test?: Test }>('/docker/import', { method: 'POST', body: { container: container.container } });
      if (saved.test) setTests(current => ({ ...current, [saved.id]: saved.test! }));
      setDocker(current => current ? { ...current, containers: current.containers.map(c => c.container === container.container ? { ...c, imported: true } : c) } : current);
      await load();
    });
  }

  async function remove(id: string) {
    await run(async () => { await call(`/${id}`, { method: 'DELETE' }); setConfirmDelete(null); await load(); });
  }

  async function backupNow() {
    if (!activeProject) return;
    await run(async () => {
      const made = await call<Backup>(`/projects/${encodeURIComponent(activeProject.id)}/backups`, { method: 'POST' });
      setNotice(`Backup created: ${made.name}`);
      await load();
    });
  }

  async function restore(name: string) {
    if (!activeProject) return;
    await run(async () => {
      await call(`/projects/${encodeURIComponent(activeProject.id)}/restore`, { method: 'POST', body: { name } });
      setConfirmRestore(null); setNotice(`Restored backup ${name}`);
      await load();
    });
  }

  async function prepare() {
    if (!activeProject) return;
    await run(async () => { setStatus(await call<ProjectStatus>(`/projects/${encodeURIComponent(activeProject.id)}/prepare`, { method: 'POST' })); });
  }

  return <div className="resource-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !draft) onClose(); }}>
    <section className="resource-page" role="dialog" aria-modal="true" aria-labelledby="resource-title">
      <header className="resource-header">
        <div><h2 id="resource-title">Service connections</h2><p>Manage shared connections to databases, caches, and other services. Agents receive connection variables while passwords stay private.</p></div>
        <button className="resource-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      {!token && <form className="resource-token" onSubmit={event => { event.preventDefault(); setControlToken(draftToken.trim()); }}>
        <p>Local authorization is required to manage connections. {isTauri() ? 'Connecting…' : 'Copy the token from ~/Library/Application Support/Wdrunge/execution-token.'}</p>
        {!isTauri() && <><input type="password" aria-label="Local authorization token" value={draftToken} onChange={e => setDraftToken(e.target.value)} /><button type="submit" disabled={!draftToken.trim()}>Connect</button></>}
      </form>}

      {token && !draft && <>
        {activeProject && status && <section className="resource-project" aria-label="Current project">
          <h3>Current project: {activeProject.name}</h3>
          {status.database === 'sqlite' && <p>This project uses the built-in SQLite database at <code>{status.data_dir}/app.db</code>. It switches to MySQL automatically when you connect it.</p>}
          {status.resources.map(item => <div key={item.id} className={`resource-state ${item.state}`}>
            <strong>{item.label}</strong>
            {item.state === 'ready' ? <span>Ready{item.own_database && item.database ? ` · Dedicated database ${item.database} (${item.user})` : ''}</span>
              : <span>Not ready: {item.error || 'Setting up'}</span>}
          </div>)}
          <div className="resource-actions">
            {status.resources.some(item => item.state === 'error') && <button disabled={busy} onClick={() => void prepare()}>Retry</button>}
            <button disabled={busy} onClick={() => void backupNow()}>Back up database</button>
          </div>
          {!!status.backups?.length && <details className="resource-backups">
            <summary>Database backups ({status.backups.length})</summary>
            <small>Wdrunge backs up the database before migrations and keeps the five most recent backups. Restoring replaces every table in the project database.</small>
            {status.backups.map(item => <div className="resource-backup-row" key={item.name}>
              <span>{new Date(item.created * 1000).toLocaleString('en-GB')} · {item.engine === 'sqlite' ? 'SQLite' : 'MySQL'} · {(item.size / 1024).toFixed(1)} KB</span>
              {confirmRestore === item.name
                ? <span><button className="danger" disabled={busy} onClick={() => void restore(item.name)}>Confirm restore</button> <button onClick={() => setConfirmRestore(null)}>Cancel</button></span>
                : <button disabled={busy} onClick={() => setConfirmRestore(item.name)}>Restore</button>}
            </div>)}
          </details>}
          {notice && <p className="resource-test ok" role="status">{notice}</p>}
        </section>}

        <div className="resource-toolbar">
          <button className="primary" disabled={busy} onClick={() => { setFormTest(null); setDraft(emptyDraft('mysql', types)); }}>+ New connection</button>
          <button disabled={busy} onClick={() => void openDocker()}>Import from Docker</button>
        </div>

        {docker && <section className="resource-docker" aria-label="Docker containers">
          <div className="resource-docker-head"><h3>Running Docker services</h3><button onClick={() => setDocker(null)}>Collapse</button></div>
          {docker.unavailable && <p>{docker.unavailable}</p>}
          {!docker.unavailable && !docker.containers.length && <p>No running containers.</p>}
          {docker.containers.map(container => <div className="resource-docker-row" key={container.container_id}>
            <span><strong>{container.type_label}</strong> · {container.container}<small>{container.image} · {container.port ? `Local port ${container.port}` : 'No mapped port'}{container.has_password ? ' · Password found' : ''}</small></span>
            {container.imported ? <em>Imported</em> : <button disabled={busy || !container.port} onClick={() => void importContainer(container)}>Import</button>}
          </div>)}
          <small>Import reads the credentials set at container startup and stores them in local application data.</small>
        </section>}

        {connections && !connections.length && <p className="resource-empty">No connections yet. Projects use built-in SQLite by default. Add a connection or import from Docker to use a service such as MySQL or Redis.</p>}
        <div className="resource-list">
          {connections?.map(connection => {
            const test = tests[connection.id];
            return <article className="resource-card" key={connection.id}>
              <div className="resource-card-head"><strong>{connection.label}</strong><span className="resource-type">{connection.type_label}</span></div>
              <p>{connection.host}:{connection.port ?? '—'}{connection.username ? ` · User ${connection.username}` : ''} · Password {connection.has_password ? 'saved' : 'not set'}
                {connection.source.kind === 'docker' ? ` · Docker (${connection.source.container})` : ''}</p>
              <p>{connection.projects === null ? 'Available to all projects' : `Only for: ${connection.projects.map(id => projectName.get(id) || 'Deleted project').join(', ') || 'None'}`}
                {connection.provision ? ' · Provisions a separate database and account for each project' : ''}</p>
              <p className="resource-vars">Name <code>{connection.name}</code> · Variables <code>{connection.env_prefix}_*</code>{connection.extra.map(e => <code key={e.key}>{e.key}</code>)}</p>
              {test && <p className={`resource-test ${test === 'running' ? '' : test.ok ? 'ok' : 'fail'}`} role="status">{test === 'running' ? 'Testing…' : test.detail}</p>}
              <div className="resource-actions">
                <button disabled={busy || test === 'running'} onClick={() => void testSaved(connection.id)}>Test connection</button>
                <button disabled={busy} onClick={() => { setFormTest(null); setDraft(fromConnection(connection, types)); }}>Edit</button>
                {confirmDelete === connection.id
                  ? <><button className="danger" disabled={busy} onClick={() => void remove(connection.id)}>Confirm deletion</button><button onClick={() => setConfirmDelete(null)}>Cancel</button></>
                  : <button disabled={busy} onClick={() => setConfirmDelete(connection.id)}>Delete</button>}
              </div>
              {confirmDelete === connection.id && <small>Projects will lose access to this connection. Databases already created on the service are kept.</small>}
            </article>;
          })}
        </div>
      </>}

      {token && draft && <form className="resource-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <h3>{draft.id ? 'Edit connection' : 'New connection'}</h3>
        <div className="resource-grid">
          <label>Type<select value={draft.type} onChange={e => chooseType(e.target.value)}>
            {types.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
            <option value={CUSTOM}>Custom…</option>
          </select></label>
          {draft.type === CUSTOM && <label>Custom type<input required placeholder="e.g. meilisearch" value={draft.customType} onChange={e => update({ customType: e.target.value, ...(!draft.id ? { name: e.target.value.toLowerCase() } : {}) })} /></label>}
          <label>Name<input required placeholder="Identifier, e.g. mysql" value={draft.name} onChange={e => update({ name: e.target.value })} /><small>Used in tasks and environment variables</small></label>
          <label>Display name<input placeholder={draftInfo?.label || 'Optional'} value={draft.label} onChange={e => update({ label: e.target.value })} /></label>
          <label>Host<input required value={draft.host} onChange={e => update({ host: e.target.value })} /></label>
          <label>Port<input inputMode="numeric" placeholder={draftInfo?.port ? String(draftInfo.port) : ''} value={draft.port} onChange={e => update({ port: e.target.value.replace(/\D/g, '') })} /></label>
          <label>Username<input autoComplete="off" value={draft.username} onChange={e => update({ username: e.target.value })} /></label>
          <label>Password<input type="password" autoComplete="new-password" placeholder={draft.hasPassword ? 'Saved. Leave blank to keep it.' : ''} value={draft.password} disabled={draft.clearPassword} onChange={e => update({ password: e.target.value })} />
            {draft.hasPassword && <span className="resource-inline"><input type="checkbox" checked={draft.clearPassword} onChange={e => update({ clearPassword: e.target.checked, password: '' })} />Clear saved password</span>}</label>
          {(!draftInfo?.can_provision || !draft.provision) && <label>Default database<input placeholder="Optional" value={draft.database} onChange={e => update({ database: e.target.value })} /></label>}
        </div>
        {draftInfo?.can_provision && <label className="resource-check"><input type="checkbox" checked={draft.provision} onChange={e => update({ provision: e.target.checked })} />
          <span>Create a separate database and account for each project (recommended)<small>The account above must be able to create databases and grant access. Each project receives credentials for its own database.</small></span></label>}

        <fieldset className="resource-projects">
          <legend>Project access</legend>
          <label className="resource-inline"><input type="radio" checked={draft.allProjects} onChange={() => update({ allProjects: true })} />All projects, including future ones</label>
          <label className="resource-inline"><input type="radio" checked={!draft.allProjects} onChange={() => update({ allProjects: false })} />Selected projects only</label>
          {!draft.allProjects && <div className="resource-project-picks">{projects.map(project => <label className="resource-inline" key={project.id}>
            <input type="checkbox" checked={draft.projects.includes(project.id)} onChange={e => update({ projects: e.target.checked ? [...draft.projects, project.id] : draft.projects.filter(id => id !== project.id) })} />{project.name}</label>)}
            {!projects.length && <small>No projects yet</small>}</div>}
        </fieldset>

        <fieldset className="resource-extra">
          <legend>Custom fields</legend>
          <small>Add settings such as access keys or regions. Projects receive these values as environment variables.</small>
          {draft.extra.map((item, index) => <div className="resource-extra-row" key={index}>
            <input aria-label="Variable name" placeholder="e.g. S3_REGION" value={item.key} onChange={e => update({ extra: draft.extra.map((x, i) => i === index ? { ...x, key: e.target.value.toUpperCase() } : x) })} />
            <input aria-label="Value" type={item.secret ? 'password' : 'text'} placeholder={item.secret && item.has_value ? 'Saved. Leave blank to keep it.' : 'Value'} value={item.value} onChange={e => update({ extra: draft.extra.map((x, i) => i === index ? { ...x, value: e.target.value } : x) })} />
            <label className="resource-inline"><input type="checkbox" checked={item.secret} onChange={e => update({ extra: draft.extra.map((x, i) => i === index ? { ...x, secret: e.target.checked } : x) })} />Secret</label>
            <button type="button" aria-label="Remove field" onClick={() => update({ extra: draft.extra.filter((_, i) => i !== index) })}>×</button>
          </div>)}
          <button type="button" onClick={() => update({ extra: [...draft.extra, { key: '', value: '', secret: false }] })}>+ Add field</button>
        </fieldset>

        <details className="resource-advanced">
          <summary>Advanced options</summary>
          <div className="resource-grid">
            <label>Variable prefix<input placeholder={defaultPrefix(draft.name || 'service')} value={draft.envPrefix} onChange={e => update({ envPrefix: e.target.value.toUpperCase() })} /></label>
            <label>Connection scheme<input placeholder="For custom service URLs, e.g. http" value={draft.scheme} onChange={e => update({ scheme: e.target.value })} /></label>
            <label className="wide">Notes<input value={draft.note} onChange={e => update({ note: e.target.value })} /></label>
          </div>
        </details>
        <p className="resource-vars">Variables available to projects: {envPreview.map(name => <code key={name}>{name}</code>)}</p>

        {formTest && <p className={`resource-test ${formTest.ok ? 'ok' : 'fail'}`} role="status">{formTest.detail}</p>}
        <div className="resource-actions">
          <button type="button" disabled={busy} onClick={() => void testDraft()}>Test connection</button>
          <span />
          <button type="button" disabled={busy} onClick={() => { setDraft(null); setFormTest(null); setError(''); }}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !draft.name.trim() || !draftType(draft)}>Save</button>
        </div>
      </form>}

      {error && <p className="resource-error" role="alert">{error}</p>}
    </section>
  </div>;
}
