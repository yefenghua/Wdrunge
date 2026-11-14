import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { localPreviewUrl, parseContext, type VisualContext, type VisualAnnotation } from './visualFeedback';
import './WebsitePreview.css';

type Mode = 'browse' | 'point';
export type WebsitePreviewHandle = { captureSelection: () => Promise<VisualContext>; clearSelection: () => void };
export default function WebsitePreview({ onRequest, onAnnotation, onSelection, annotations = [], busy, onClose, ref }: {
  onRequest: (content: string) => Promise<void>; busy: boolean; onClose: () => void;
  onAnnotation: (item: VisualAnnotation) => void; onSelection?: (context: VisualContext | null) => void;
  annotations?: VisualAnnotation[]; ref?: Ref<WebsitePreviewHandle>;
}) {
  const [address, setAddress] = useState('http://127.0.0.1:8101');
  const [url, setUrl] = useState('');
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('browse');
  const [context, setContext] = useState<VisualContext | null>(null);
  const [requirement, setRequirement] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshPhase = useRef<'idle' | 'connecting' | 'fetching' | 'reloading'>('idle');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canReload = useRef(false);
  const [popupOpen, setPopupOpen] = useState(true);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [popupHeight, setPopupHeight] = useState(260);
  const viewport = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLFormElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const token = useRef(crypto.randomUUID());
  const pageId = useRef('');
  const awaiting = useRef<{ id: string; resolve: (value: VisualContext) => void; reject: (error: Error) => void } | null>(null);
  const lastReady = useRef(0);
  const lastPageUrl = useRef('');
  const origin = url ? new URL(url).origin : '';
  function finishRefresh(message?: string) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = null; refreshPhase.current = 'idle'; setRefreshing(false);
    if (message) setError(message);
  }
  function refreshPreview() {
    try {
      const next = localPreviewUrl(address);
      setError(''); setNotice('Fetching the page and assets…'); setRefreshing(true);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => finishRefresh('Force refresh timed out. Confirm the site uses the latest selection script and is running.'), 20000);
      if (ready && canReload.current && next === lastPageUrl.current) {
        refreshPhase.current = 'fetching'; command('wdrunge:reload');
      } else {
        // Older bridges need one reload to pick up the new refresh command.
        refreshPhase.current = 'connecting'; setUrl(next); setRevision(value => value + 1);
      }
    } catch (cause) { setError((cause as Error).message); }
  }
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  const elements = context?.elements || [];
  const hasSelection = !!(elements.length || context?.region);
  const selectionKey = context ? JSON.stringify([context.url, context.elements.map(item => item.selector), context.region]) : '';
  useEffect(() => { setRequirement(''); setPopupOpen(true); }, [selectionKey]);
  useEffect(() => { onSelection?.(hasSelection ? context : null); }, [context, hasSelection, onSelection]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect; setBounds({ width: rect.width, height: rect.height });
    });
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (ready) command('wdrunge:annotations', { annotations }); }, [annotations, ready, url, revision]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setPopupHeight(entries[0].borderBoxSize?.[0]?.blockSize || entries[0].contentRect.height));
    if (popover.current) observer.observe(popover.current);
    return () => observer.disconnect();
  }, [hasSelection, popupOpen]);
  useImperativeHandle(ref, () => ({ captureSelection: freshContext, clearSelection: () => command('wdrunge:clear') }));
  function command(type: string, extra = {}) {
    if (origin) frame.current?.contentWindow?.postMessage({ type, token: token.current, pageId: pageId.current, ...extra }, origin);
  }
  function discard(reason: string) {
    setContext(null); setNotice(reason);
    awaiting.current?.reject(new Error(reason)); awaiting.current = null;
  }
  useEffect(() => {
    if (!url) return;
    token.current = crypto.randomUUID(); pageId.current = ''; lastReady.current = 0;
    setReady(false); setMode('browse'); setContext(null);
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin || event.data?.token !== token.current) return;
      const data = event.data;
      if (typeof data.pageId !== 'string') return;
      if (data.type === 'wdrunge:ready') {
        try { if (new URL(localPreviewUrl(data.url)).origin !== origin) return; } catch { return; }
        if (pageId.current && pageId.current !== data.pageId) discard('The page reloaded. Select the area again.');
        pageId.current = data.pageId; lastReady.current = Date.now(); setReady(true);
        canReload.current = Array.isArray(data.capabilities) && data.capabilities.includes('reload');
        if (lastPageUrl.current !== data.url) { lastPageUrl.current = data.url; setAddress(data.url); }
        if (refreshPhase.current === 'connecting') {
          refreshPhase.current = 'fetching'; command('wdrunge:reload');
        }
        return;
      }
      if (data.pageId !== pageId.current) return;
      if (data.type === 'wdrunge:reloading' && refreshPhase.current === 'fetching') refreshPhase.current = 'reloading';
      if (data.type === 'wdrunge:reload-error' && refreshPhase.current !== 'idle') {
        finishRefresh(typeof data.message === 'string' ? data.message.slice(0, 300) : 'Could not refresh the assets. Try again.');
        return;
      }
      if (data.type === 'wdrunge:page') {
        discard('The page route changed. The previous selection was cleared.');
        if (typeof data.url === 'string') { lastPageUrl.current = data.url; setAddress(data.url); }
      }
      if (data.type === 'wdrunge:selection') {
        const item = parseContext(data.context);
        if (!item || new URL(item.url).origin !== origin) return;
        setContext(item); setNotice(item.elements.length || item.region ? '' : 'Selection cleared. If the page replaced the element, select it again.');
        if (['browse','point'].includes(data.mode)) setMode(data.mode);
        if (awaiting.current && data.requestId === awaiting.current.id) { awaiting.current.resolve(item); awaiting.current = null; }
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMode('browse'); command('wdrunge:mode', { mode: 'browse' }); command('wdrunge:clear');
    }
    window.addEventListener('message', receive); window.addEventListener('keydown', escape);
    const timer = setInterval(() => {
      command('wdrunge:connect');
      if (lastReady.current && Date.now() - lastReady.current > 3000) {
        lastReady.current = 0; pageId.current = ''; setReady(false); setMode('browse');
        discard('Preview disconnected. Check the URL and selection script.');
      }
    }, 800);
    command('wdrunge:connect');
    return () => {
      window.removeEventListener('message', receive); window.removeEventListener('keydown', escape); clearInterval(timer);
      awaiting.current?.reject(new Error('Preview closed or changed')); awaiting.current = null;
    };
  }, [url, revision, origin]);
  function freshContext(): Promise<VisualContext> {
    if (awaiting.current) return Promise.reject(new Error('Capturing the selection. Try again shortly.'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        if (awaiting.current?.id === id) { awaiting.current = null; reject(new Error('Could not capture the latest page state. Refresh and select again.')); }
      }, 2500);
      awaiting.current = { id, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
      command('wdrunge:snapshot', { requestId: id });
    });
  }
  async function submit(content: string) {
    if (busy || sending) return;
    setSending(true); setError('');
    try {
      await onRequest(content); setRequirement('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send the request'); }
    finally { setSending(false); }
  }
  async function addAnnotation() {
    if (!requirement.trim() || sending || busy) return;
    const originalKey = selectionKey;
    setSending(true); setError('');
    try {
      const current = await freshContext();
      const key = JSON.stringify([current.url, current.elements.map(item => item.selector), current.region]);
      if ((!current.elements.length && !current.region) || key !== originalKey) throw new Error('The selection changed. Select it again before adding the annotation.');
      if (annotations.length >= 10) throw new Error('You can add up to 10 annotations at once. Send or remove some first.');
      onAnnotation({ id: crypto.randomUUID(), comment: requirement.trim(), context: current });
      command('wdrunge:clear'); setRequirement('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add the annotation'); }
    finally { setSending(false); }
  }
  const scriptUrl = new URL(`${import.meta.env.BASE_URL}visual-inspector.js`, window.location.href).href;
  const snippet = `<script src="${scriptUrl}" defer></script>`;
  const rects = elements.map(element => element.rect);
  const anchor = context?.region ? { ...context.region, x: context.region.x - context.viewport.scrollX, y: context.region.y - context.viewport.scrollY }
    : rects.length ? { x: Math.min(...rects.map(r => r.x)), y: Math.min(...rects.map(r => r.y)), width: 0, height: Math.max(...rects.map(r => r.y + r.height)) - Math.min(...rects.map(r => r.y)) } : null;
  const popupStyle = { left: Math.max(8, Math.min(anchor?.x || 8, bounds.width - 348)),
    top: Math.max(8, Math.min(anchor && anchor.y + anchor.height + popupHeight + 16 < bounds.height ? anchor.y + anchor.height + 8 : (anchor?.y || popupHeight + 16) - popupHeight - 8, bounds.height - popupHeight - 8)) };
  function choose(next: Mode) { setMode(next); command('wdrunge:mode', { mode: next }); }
  return <section className="website-preview" aria-label="Site preview">
    <header><strong>Site Preview</strong><button onClick={onClose}>Back to Office</button></header>
    <form className="website-address" onSubmit={event => {
      event.preventDefault();
      try { const next = localPreviewUrl(address); finishRefresh(); setUrl(next); setRevision(value => value + 1); setError(''); setNotice(''); }
      catch (cause) { setError((cause as Error).message); }
    }}><input aria-label="Preview URL" value={address} onChange={event => setAddress(event.target.value)} /><button>Open</button>
      <button type="button" disabled={!url || refreshing} onClick={refreshPreview}>{refreshing ? 'Refreshing…' : 'Refresh'}</button></form>
    <div className="website-tools">
      <button disabled={!ready || refreshing} aria-pressed={mode === 'browse'} onClick={() => choose('browse')}>Browse</button>
      <button disabled={!ready || refreshing} aria-pressed={mode === 'point'} onClick={() => choose('point')}>Select Area</button>
      {hasSelection && <><button onClick={() => setPopupOpen(value => !value)}>Annotate Selection</button>
        <button disabled={elements.length !== 1 || !elements[0]?.ancestors.length} onClick={() => command('wdrunge:parent')}>Select Parent</button>
        <button onClick={() => command('wdrunge:clear')}>Clear Selection</button></>}
      <span role="status">{refreshing ? 'Refreshing page assets…' : !ready ? 'Waiting for the selection script' : mode === 'point' ? 'Click to select · Drag to box-select · Click again to remove · Shift to add · Esc to exit' : 'Connected — select an element'}</span>
    </div>
    {notice && <p role="status" className="website-notice">{notice}</p>}
    {error && <p role="alert" className="website-error">{error}</p>}
    {url && !ready && <details className="website-setup"><summary>Can browse but not select? Add the selection script</summary>
      <p>Add this script to the development page, then refresh the preview. If the page does not load, start its server and allow iframe embedding.</p><code>{snippet}</code>
      <button disabled={busy || sending} onClick={() => void submit(`Add the Wdrunge element-selection script to this project's local development site. The preview URL is ${url}. Add ${snippet} to the development entry HTML or framework entry, in development only, so the production site never loads a local script. Inspect the existing framework and entry point first, then verify the service and tell me to refresh the preview.`)}>Ask Agent to Add It</button>
    </details>}
    <div className="website-viewport" ref={viewport}>{url ? <iframe key={`${url}:${revision}`} ref={frame} title="Project site" src={url}
      sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" onLoad={() => {
        if (refreshPhase.current === 'reloading') finishRefresh();
        token.current = crypto.randomUUID(); pageId.current = ''; lastReady.current = 0;
        setReady(false); setContext(null); setMode('browse'); discard('Page loaded. Select the area you want to change.'); command('wdrunge:connect');
      }} /> : <div className="website-empty">Start the project site, then enter its local URL above.<br />Select elements or drag over a region to show the team what to change.</div>}
    {hasSelection && popupOpen && <form ref={popover} className="website-comment-popover" aria-label="Selection annotation" style={popupStyle}
      onSubmit={event => { event.preventDefault(); void addAnnotation(); }}>
      <div className="website-comment-heading"><strong>{context?.region ? `Region selected · ${elements.length} elements` : elements.length === 1 ? `Selected ${elements[0].tag}` : `${elements.length} elements selected`}</strong>
        <button type="button" aria-label="Close annotation" onClick={() => setPopupOpen(false)}>×</button></div>
      <div className="website-selection-list">{elements.map((element, index) => <div key={`${element.selector}:${index}`}><span title={element.selector}>{element.tag} · {element.text || element.selector}</span><button type="button" aria-label={`Remove element ${index + 1}`} onClick={() => command('wdrunge:remove', { index })}>×</button></div>)}</div>
      {context?.truncated && <small role="status">Only the first 20 elements are kept. Narrow the region or split the request.</small>}
      {context?.region && !elements.length && <small>This region contains coordinates only. Select a nearby element to improve targeting.</small>}
      <textarea aria-label="Annotation comment" disabled={sending || busy} placeholder="What should change here?" value={requirement} onChange={event => setRequirement(event.target.value)} maxLength={2000}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (requirement.trim()) void addAnnotation(); } }} />
      <div className="website-comment-footer"><small>You can also send the request in team chat</small><button disabled={!requirement.trim() || !ready || busy || sending}>{sending ? 'Adding…' : 'Add Annotation'}</button></div>
    </form>}
    </div>
  </section>;
}
