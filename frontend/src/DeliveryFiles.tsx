import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import './DeliveryFiles.css';

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:17420';
export type DeliveryEntry = { path: string; name: string; kind: 'file' | 'folder'; size: number; modified: number };
export type DeliveryState = { entries: DeliveryEntry[]; revision: string; truncated: boolean; status: 'connecting' | 'live' | 'reconnecting' };
type Preview = { path: string; kind: 'markdown' | 'text' | 'image' | 'pdf' | 'unsupported'; content: string; size: number; truncated: boolean };
export const deliveryUrl = (project: string, endpoint: string) => `${apiBase}/api/projects/${encodeURIComponent(project)}/delivery/${endpoint}`;
const htmlExtension = /\.html?$/i;

function workspacePath(fromPath: string, href: string | null) {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href.trim())) return null;
  try {
    const base = new URL(fromPath.split('/').map(encodeURIComponent).join('/'), 'https://workspace.invalid/');
    const resolved = new URL(href, base);
    return decodeURIComponent(resolved.pathname.slice(1));
  } catch { return null; }
}

function rewriteCssResources(css: string, fromPath: string, resource: (path: string) => string) {
  return css.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, _quote, href: string) => {
    const local = workspacePath(fromPath, href);
    return local ? `url("${resource(local)}")` : match;
  });
}

async function buildHtmlPreview(content: string, path: string, project: string, revision: string, signal: AbortSignal) {
  const document = new DOMParser().parseFromString(content, 'text/html');
  const resource = (local: string) => `${deliveryUrl(project, 'file')}?path=${encodeURIComponent(local)}&revision=${encodeURIComponent(revision)}`;
  document.querySelectorAll('base').forEach(element => element.remove());
  document.querySelectorAll('meta').forEach(element => {
    if (['content-security-policy', 'refresh'].includes(element.httpEquiv.toLowerCase())) element.remove();
  });

  const stylesheetLinks = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')];
  await Promise.all(stylesheetLinks.map(async link => {
    const local = workspacePath(path, link.getAttribute('href'));
    if (!local) return;
    try {
      const response = await fetch(resource(local), { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`CSS ${response.status}`);
      const style = document.createElement('style');
      style.dataset.source = local;
      style.textContent = rewriteCssResources(await response.text(), local, resource);
      link.replaceWith(style);
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') throw cause;
      link.href = resource(local);
    }
  }));

  document.querySelectorAll<HTMLElement>('[style]').forEach(element => {
    element.setAttribute('style', rewriteCssResources(element.getAttribute('style') || '', path, resource));
  });
  document.querySelectorAll<HTMLStyleElement>('style').forEach(style => {
    style.textContent = rewriteCssResources(style.textContent || '', style.dataset.source || path, resource);
  });
  for (const attribute of ['src', 'poster'] as const) {
    document.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach(element => {
      const local = workspacePath(path, element.getAttribute(attribute));
      if (local) element.setAttribute(attribute, resource(local));
    });
  }
  document.querySelectorAll<HTMLElement>('[srcset]').forEach(element => {
    const candidates = (element.getAttribute('srcset') || '').split(',').map(candidate => {
      const [href, ...descriptor] = candidate.trim().split(/\s+/);
      const local = workspacePath(path, href);
      return [local ? resource(local) : href, ...descriptor].join(' ');
    });
    element.setAttribute('srcset', candidates.join(', '));
  });
  document.querySelectorAll<HTMLElement>('[href]').forEach(element => {
    if (element.tagName === 'A') {
      const href = element.getAttribute('href');
      const local = workspacePath(path, href);
      if (local) {
        element.dataset.wdrungePath = local;
        element.setAttribute('href', '#');
      } else if (href && !href.startsWith('#')) {
        element.setAttribute('href', '#');
        element.setAttribute('title', 'External links are disabled in this preview');
      }
      return;
    }
    const local = workspacePath(path, element.getAttribute('href'));
    if (local) element.setAttribute('href', resource(local));
  });

  const policy = document.createElement('meta');
  const apiOrigin = new URL(apiBase, window.location.href).origin;
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; img-src ${apiOrigin} data: blob:; style-src ${apiOrigin} 'unsafe-inline'; font-src ${apiOrigin} data:; media-src ${apiOrigin} data: blob:; script-src ${apiOrigin} 'unsafe-inline'; connect-src ${apiOrigin}; object-src 'none'; base-uri 'none'; form-action 'none'`;
  document.head.prepend(policy);
  const bridge = document.createElement('script');
  bridge.textContent = `document.addEventListener('click',function(event){var link=event.target.closest&&event.target.closest('a[data-wdrunge-path]');if(link){event.preventDefault();parent.postMessage({type:'wdrunge:open-preview',path:link.dataset.wdrungePath},'*')}});document.addEventListener('submit',function(event){event.preventDefault()});`;
  document.body.append(bridge);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export function useDeliveryFiles(project: string | undefined): DeliveryState {
  const [state, setState] = useState<DeliveryState>({ entries: [], revision: '', truncated: false, status: 'connecting' });
  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setState({ entries: [], revision: '', truncated: false, status: 'connecting' });
    if (!project) return;
    function connect() {
      if (disposed) return;
      stream = new EventSource(deliveryUrl(project!, 'events'));
      stream.addEventListener('files', event => {
        if (disposed) return;
        try {
          const data = JSON.parse((event as MessageEvent).data);
          setState({ ...data, status: 'live' });
        } catch { /* A malformed event must not erase the last valid directory. */ }
      });
      stream.onerror = () => {
        stream?.close();
        if (!disposed) {
          setState(current => ({ ...current, status: 'reconnecting' }));
          retry = setTimeout(connect, 1500);
        }
      };
    }
    connect();
    return () => { disposed = true; stream?.close(); clearTimeout(retry); };
  }, [project]);
  return state;
}

export function DeliveryTree({ files, selected, onOpen }: { files: DeliveryState; selected: string | null; onOpen: (path: string) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['docs']));
  const [query, setQuery] = useState('');
  const children = new Map<string, DeliveryEntry[]>();
  const matches = query.trim().toLocaleLowerCase();
  const shown = new Set<string>();
  for (const entry of files.entries) {
    if (!matches || entry.path.toLocaleLowerCase().includes(matches)) {
      let path = entry.path;
      shown.add(path);
      while (path.includes('/')) { path = path.slice(0, path.lastIndexOf('/')); shown.add(path); }
    }
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    children.set(parent, [...(children.get(parent) || []), entry]);
  }
  function branch(parent: string, depth: number) {
    return (children.get(parent) || []).filter(entry => shown.has(entry.path)).map(entry => {
      const open = expanded.has(entry.path) || !!matches;
      return <li key={entry.path}>
        <button className={`delivery-entry ${selected === entry.path ? 'selected' : ''}`} style={{ paddingLeft: 10 + depth * 16 }}
          aria-expanded={entry.kind === 'folder' ? open : undefined} aria-current={selected === entry.path ? 'true' : undefined}
          title={entry.path} onClick={() => {
            if (entry.kind === 'file') onOpen(entry.path);
            else setExpanded(current => { const next = new Set(current); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next; });
          }}><span className="delivery-chevron" aria-hidden="true">{entry.kind === 'folder' ? (open ? '⌄' : '›') : ''}</span><span className={`delivery-file-icon ${entry.kind}`} aria-hidden="true">{entry.kind === 'folder' ? '▱' : '≡'}</span><span className="delivery-name">{entry.name}</span>{entry.kind === 'file' && <small>{formatSize(entry.size)}</small>}</button>
        {entry.kind === 'folder' && open && <ul>{branch(entry.path, depth + 1)}</ul>}
      </li>;
    });
  }
  return <div className="delivery-browser">
    <label className="delivery-search"><span aria-hidden="true">⌕</span><input aria-label="Filter delivery files" placeholder="Find files or folders…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="delivery-tree-heading"><span>Project files</span><span className={`delivery-connection ${files.status}`} role="status"><i />{files.status === 'live' ? 'Live sync' : files.status === 'connecting' ? 'Loading…' : 'Reconnecting…'}</span></div>
    <nav aria-label="Delivery file tree"><ul>{branch('', 0)}</ul></nav>
    {files.status === 'live' && !files.entries.length && <div className="delivery-empty">No delivered files yet<small>Files appear here as the team creates them.</small></div>}
    {!!files.entries.length && !shown.size && <p className="delivery-empty">No matching files or folders</p>}
    {files.truncated && <p className="delivery-note">This directory has over 10,000 items. Only the first 10,000 are shown.</p>}
  </div>;
}

function formatSize(size: number) {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function DeliveryPreview({ project, path, revision, status, onClose, onOpen }: { project: string; path: string; revision: string; status: DeliveryState['status']; onClose: () => void; onOpen: (path: string) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(true);
  const [resourceVersion, setResourceVersion] = useState('');
  const [htmlView, setHtmlView] = useState<'page' | 'source'>('page');
  const [htmlDocument, setHtmlDocument] = useState('');
  const [htmlError, setHtmlError] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);
  const htmlFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setRefreshing(true);
    void fetch(`${deliveryUrl(project, 'preview')}?path=${encodeURIComponent(path)}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not read this file');
      if (current) { setPreview(data); setError(''); setResourceVersion(revision); }
    }).catch(cause => {
      if (current) { setPreview(null); setError(cause instanceof Error ? cause.message : 'Could not read this file'); }
    }).finally(() => { if (current) setRefreshing(false); });
    return () => { current = false; controller.abort(); };
  }, [project, path, revision]);
  const resource = `${deliveryUrl(project, 'file')}?path=${encodeURIComponent(path)}&revision=${encodeURIComponent(resourceVersion)}`;
  const isHtml = preview?.kind === 'text' && htmlExtension.test(path);
  useEffect(() => { setHtmlView('page'); }, [path]);
  useEffect(() => {
    setHtmlDocument(''); setHtmlError('');
    if (!isHtml || !preview) return;
    const controller = new AbortController();
    void buildHtmlPreview(preview.content, path, project, resourceVersion, controller.signal)
      .then(content => setHtmlDocument(content))
      .catch(cause => { if (!controller.signal.aborted) setHtmlError(cause instanceof Error ? cause.message : 'Could not generate the page preview'); });
    return () => controller.abort();
  }, [isHtml, preview, path, project, resourceVersion]);
  useEffect(() => {
    if (!isHtml) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== htmlFrame.current?.contentWindow || event.data?.type !== 'wdrunge:open-preview' || typeof event.data.path !== 'string') return;
      const target = event.data.path.replace(/\\/g, '/');
      if (target && !target.startsWith('/') && !target.split('/').includes('..')) onOpen(target);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [isHtml, onOpen]);
  function localPath(href: string | undefined) {
    return workspacePath(path, href || null);
  }
  return <section className="delivery-overlay" role="dialog" aria-label={`File preview: ${path}`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header className="delivery-preview-heading"><div><span className="delivery-preview-eyebrow">{isHtml ? 'Page preview' : 'Delivery file'}</span><strong title={path}>{path.split('/').pop()}</strong><small title={path}>{path}</small></div><button type="button" ref={closeButton} onClick={onClose} aria-label="Close file preview" title="Close · Esc">×</button></header>
    <div className="delivery-preview-toolbar"><span role="status">{refreshing ? 'Updating…' : status === 'live' ? 'Up to date' : 'Updates after reconnecting'}{preview && ` · ${formatSize(preview.size)}`}</span><div className="delivery-preview-actions">{isHtml && <div className="delivery-view-switch" role="group" aria-label="HTML view mode"><button type="button" className={htmlView === 'page' ? 'active' : ''} aria-pressed={htmlView === 'page'} onClick={() => setHtmlView('page')}>Preview</button><button type="button" className={htmlView === 'source' ? 'active' : ''} aria-pressed={htmlView === 'source'} onClick={() => setHtmlView('source')}>Source</button></div>}<a href={`${resource}&download=true`}>Download ↗</a></div></div>
    <div className={`delivery-preview-body${isHtml && htmlView === 'page' ? ' delivery-html-view' : ''}`}>
      {error && <div className="delivery-preview-empty" role="alert"><strong>{error}</strong><p>This file will reopen automatically when it becomes available.</p></div>}
      {!preview && !error && <div className="delivery-preview-empty">Opening file…</div>}
      {preview?.kind === 'markdown' && <div className="markdown-body delivery-markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml components={{
        a: ({ href, children }) => { const local = localPath(href); return local ? <a href="#" onClick={event => { event.preventDefault(); onOpen(local); }}>{children}</a> : <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>; },
        img: ({ src, alt }) => { const local = localPath(typeof src === 'string' ? src : undefined); return <img alt={alt || ''} src={local ? `${deliveryUrl(project, 'file')}?path=${encodeURIComponent(local)}&revision=${encodeURIComponent(resourceVersion)}` : src} loading="lazy" />; },
      }}>{preview.content}</ReactMarkdown></div>}
      {isHtml && htmlView === 'page' && (htmlError ? <div className="delivery-preview-empty" role="alert"><strong>Page preview unavailable</strong><p>{htmlError}</p><button type="button" onClick={() => setHtmlView('source')}>Source</button></div> : htmlDocument ? <iframe ref={htmlFrame} className="delivery-html" title={`${path} preview`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={htmlDocument} /> : <div className="delivery-preview-empty">Preparing preview…</div>)}
      {preview?.kind === 'text' && (!isHtml || htmlView === 'source') && <pre className="delivery-source"><code>{preview.content}</code></pre>}
      {preview?.kind === 'image' && <div className="delivery-image"><img src={resource} alt={path} /></div>}
      {preview?.kind === 'pdf' && <iframe className="delivery-pdf" title={path} src={resource} />}
      {preview?.kind === 'unsupported' && <div className="delivery-preview-empty"><strong>Preview unavailable for this file type</strong><p>Download the file to open it in another app.</p><a href={`${resource}&download=true`}>Download {path.split('/').pop()}</a></div>}
      {preview?.truncated && <p className="delivery-note">Showing the first 2 MB. Download the file to view it in full.</p>}
    </div>
  </section>;
}
