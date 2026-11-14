/* Development-only bridge. DOM observations, no form values/cookies/storage/HTML. */
(() => {
  if (window.__wdrungeInspector || window.parent === window) return;
  window.__wdrungeInspector = true;
  const owner = new URL(document.currentScript.src).origin;
  const pageId = crypto.randomUUID();
  let token = '', mode = 'browse', selected = [], hovered = null, region = null, truncated = false;
  let lastLocation = location.href, lastSnapshot = '', drag = null, suppressClick = false;
  let annotations = [];
  let reloading = false;
  async function reloadResources() {
    if (reloading) return;
    reloading = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      // A new iframe or HTML cache-buster alone still reuses fresh CSS/JS cache entries.
      // Revalidate only resources already loaded by this document, never replay XHR/API calls.
      const resources = [location.href,
        ...[...document.querySelectorAll('link[rel="stylesheet"][href],script[src]')].map(element => element.href || element.src),
        ...performance.getEntriesByType('resource').filter(entry => ['link', 'script', 'css', 'img'].includes(entry.initiatorType)).map(entry => entry.name)];
      const urls = [...new Set(resources.map(value => new URL(value, location.href)).filter(url =>
        url.origin === location.origin && ['http:', 'https:'].includes(url.protocol)).map(url => { url.hash = ''; return url.href; }))];
      if (urls.length > 100) throw new Error('Too many page assets. Use the browser\'s hard refresh.');
      await Promise.all(urls.map(async url => {
        const response = await fetch(url, { cache: 'reload', credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error(`Asset refresh failed (${response.status}): ${new URL(url).pathname}`);
        await response.arrayBuffer(); // Wait until the updated response has entered the HTTP cache.
      }));
      send('wdrunge:reloading'); location.reload();
    } catch (error) {
      controller.abort(); reloading = false;
      send('wdrunge:reload-error', { message: error.name === 'AbortError' ? 'Timed out while refreshing page assets. Check the site and try again.' : error.message });
    } finally { clearTimeout(timer); }
  }
  const host = document.createElement('div');
  host.setAttribute('data-wdrunge-overlay', '');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647' });
  const shadow = host.attachShadow({ mode: 'closed' });
  document.documentElement.append(host);
  function send(type, data = {}) { if (token) window.parent.postMessage({ type, token, pageId, ...data }, owner); }
  function pageUrl() {
    const url = new URL(location.href);
    for (const key of [...url.searchParams.keys()]) if (/token|key|password|secret|auth|session|code/i.test(key)) url.searchParams.delete(key);
    return url.href;
  }
  function box(r, dashed = false) {
    const div = document.createElement('div');
    Object.assign(div.style, { position: 'fixed', pointerEvents: 'none', boxSizing: 'border-box',
      border: `2px ${dashed ? 'dashed' : 'solid'} #3b82f6`, background: '#3b82f612',
      left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    shadow.append(div);
  }
  function draw() {
    shadow.replaceChildren();
    annotations.forEach((annotation, index) => {
      const context = annotation.context;
      if (context.url !== pageUrl()) return;
      const rects = context.region ? [context.region] : context.elements.map(element => ({ ...element.rect,
        x: element.rect.x + context.viewport.scrollX, y: element.rect.y + context.viewport.scrollY }));
      const r = rects[0];
      if (!r) return;
      rects.forEach(rect => box({ ...rect, x: rect.x - scrollX, y: rect.y - scrollY }, true));
      const marker = document.createElement('span'); marker.textContent = String(index + 1);
      Object.assign(marker.style, { position: 'fixed', left: `${Math.max(0, r.x + r.width - scrollX - 12)}px`,
        top: `${r.y - scrollY - 12}px`, background: '#3975ef', color: '#fff', border: '2px solid white',
        borderRadius: '50%', width: '24px', height: '24px', display: 'grid', placeItems: 'center',
        font: 'bold 12px system-ui', boxShadow: '0 2px 6px #0002' });
      // Saved coordinates mark the observation, not a newly resolved DOM identity.
      marker.title = annotation.comment; shadow.append(marker);
    });
    for (const element of selected) if (element.isConnected) box(element.getBoundingClientRect());
    if (hovered?.isConnected && !selected.includes(hovered)) box(hovered.getBoundingClientRect(), true);
    if (region) box({ ...region, x: region.x - scrollX, y: region.y - scrollY }, true);
    if (drag?.moved) box(dragRect(), true);
  }
  function selector(element) {
    const parts = [];
    for (let node = element; node; node = node.parentElement) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      const siblings = node.parentElement ? [...node.parentElement.children].filter(child => child.localName === node.localName) : [];
      parts.unshift(node.localName + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''));
      if (parts.join(' > ').length > 900) break;
    }
    return parts.join(' > ');
  }
  function text(element) {
    if (element.closest('input,textarea,select,[contenteditable],script,style')) return '';
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let result = '', node, count = 0;
    while ((node = walker.nextNode()) && result.length < 300 && count++ < 2000) {
      if (!node.parentElement.closest('input,textarea,select,[contenteditable],script,style')) result += node.textContent.slice(0, 300 - result.length) + ' ';
    }
    return result.replace(/\s+/g, ' ').trim().slice(0, 300);
  }
  function observation(element) {
    const r = element.getBoundingClientRect(), computed = getComputedStyle(element), ancestors = [];
    for (let node = element.parentElement; node && ancestors.length < 6; node = node.parentElement)
      ancestors.push({ tag: node.localName, text: text(node).slice(0, 80) });
    return { url: pageUrl(), tag: element.localName, text: text(element), selector: selector(element),
      source: element.closest('[data-wdrunge-source]')?.getAttribute('data-wdrunge-source') || '',
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      styles: Object.fromEntries(['color','backgroundColor','fontSize','fontWeight','display','margin','padding','borderRadius'].map(key => [key, computed[key]])), ancestors };
  }
  function snapshot() {
    selected = selected.filter(element => element.isConnected);
    let common = selected[0];
    while (common && !selected.every(element => common.contains(element))) common = common.parentElement;
    return { url: pageUrl(), capturedAt: new Date().toISOString(), elements: selected.map(observation),
      ...(region ? { region } : {}), ...(selected.length > 1 && common ? { commonAncestor: observation(common) } : {}),
      truncated, viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY } };
  }
  function publish(force = false, requestId) {
    const context = snapshot();
    const fingerprint = JSON.stringify({ ...context, capturedAt: '' });
    if (force || fingerprint !== lastSnapshot) {
      lastSnapshot = fingerprint; send('wdrunge:selection', { context, mode, ...(requestId ? { requestId } : {}) });
    }
    draw();
  }
  function clear() { selected = []; hovered = null; region = null; truncated = false; drag = null; publish(true); }
  function routeChanged() {
    if (lastLocation === location.href) return;
    lastLocation = location.href; clear(); send('wdrunge:page', { url: pageUrl() });
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== owner) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.token !== 'string' || data.token.length > 100) return;
    if (data.type === 'wdrunge:connect') {
      token = data.token; send('wdrunge:ready', { url: pageUrl(), mode, capabilities: ['reload'] }); return;
    }
    if (data.token !== token || data.pageId !== pageId) return;
    if (data.type === 'wdrunge:reload') { void reloadResources(); return; }
    if (data.type === 'wdrunge:annotations' && Array.isArray(data.annotations)) {
      annotations = data.annotations.slice(0, 10).filter(item => item?.context?.viewport && Array.isArray(item.context.elements)); draw();
    }
    if (data.type === 'wdrunge:mode' && ['browse','point'].includes(data.mode)) {
      mode = data.mode; hovered = null; drag = null; suppressClick = false; publish(true);
    }
    if (data.type === 'wdrunge:parent' && selected.length === 1 && selected[0].parentElement) {
      selected = [selected[0].parentElement]; region = null; publish(true);
    }
    if (data.type === 'wdrunge:remove' && Number.isInteger(data.index) && data.index >= 0 && data.index < selected.length) { selected.splice(data.index, 1); region = null; publish(true); }
    if (data.type === 'wdrunge:clear') clear();
    if (data.type === 'wdrunge:snapshot' && typeof data.requestId === 'string') { routeChanged(); publish(true, data.requestId); }
  });
  function target(event) { return event.target instanceof Element && event.target !== host ? event.target : null; }
  function dragRect() {
    const { x, y, endX, endY } = drag;
    return { x: Math.min(x, endX), y: Math.min(y, endY), width: Math.abs(endX - x), height: Math.abs(endY - y) };
  }
  document.addEventListener('pointermove', event => {
    if (mode === 'browse') return;
    if (drag) {
      event.preventDefault(); event.stopImmediatePropagation();
      drag.endX = event.clientX; drag.endY = event.clientY;
      drag.moved ||= Math.hypot(drag.endX - drag.x, drag.endY - drag.y) >= 6;
    }
    else hovered = mode === 'point' ? target(event) : null;
    draw();
  }, true);
  document.addEventListener('pointerdown', event => {
    if (mode === 'browse' || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    drag = { x: event.clientX, y: event.clientY, endX: event.clientX, endY: event.clientY,
      additive: event.shiftKey, target: target(event), moved: false, pointerId: event.pointerId };
    // Capture keeps a drag coherent even when the pointer leaves the iframe.
    try { document.documentElement.setPointerCapture(event.pointerId); } catch { /* pointer already ended */ }
  }, true);
  document.addEventListener('pointerup', event => {
    if (mode === 'browse' || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!drag) return;
    drag.endX = event.clientX; drag.endY = event.clientY;
    const r = dragRect(), additive = drag.additive, element = drag.target;
    const moved = drag.moved || Math.hypot(drag.endX - drag.x, drag.endY - drag.y) >= 6;
    drag = null; suppressClick = true;
    try { document.documentElement.releasePointerCapture(event.pointerId); } catch { /* no active capture */ }
    if (!moved) {
      if (!element?.isConnected) return;
      region = null; truncated = false; hovered = null;
      if (selected.includes(element)) selected = selected.filter(item => item !== element);
      else if (additive) { if (selected.length < 20) selected.push(element); else truncated = true; }
      else selected = [element];
      publish(true); return;
    }
    if (r.width < 4 || r.height < 4) { publish(true); return; }
    region = { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    // Fully enclosed top-level boxes: a whole card wins over its descendants.
    const candidates = [], nodes = document.querySelectorAll('body *');
    let scanned = 0; truncated = false;
    for (const element of nodes) {
      if (++scanned > 10000) { truncated = true; break; }
      if (element === host || ['SCRIPT','STYLE','LINK','META'].includes(element.tagName)) continue;
      const b = element.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0 || getComputedStyle(element).visibility === 'hidden') continue;
      if (b.left >= r.x && b.top >= r.y && b.right <= r.x + r.width && b.bottom <= r.y + r.height
          && !candidates.some(parent => parent.contains(element))) candidates.push(element);
    }
    const combined = [...new Set([...(additive ? selected : []), ...candidates])];
    truncated = truncated || combined.length > 20;
    selected = combined.slice(0, 20); hovered = null; publish(true);
  }, true);
  document.addEventListener('click', event => {
    if (mode === 'browse') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (suppressClick) { suppressClick = false; return; }
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { mode = 'browse'; clear(); } }, true);
  document.addEventListener('pointercancel', () => { drag = null; draw(); }, true);
  document.addEventListener('lostpointercapture', () => { if (drag) { drag = null; draw(); } }, true);
  window.addEventListener('scroll', () => { if (selected.length || region) publish(); else draw(); }, true);
  window.addEventListener('resize', () => { if (selected.length || region) publish(); else draw(); });
  let mutationTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => { routeChanged(); if (selected.length || region) publish(); }, 100);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  for (const name of ['pushState','replaceState']) {
    const original = history[name];
    history[name] = function (...args) { const result = original.apply(this, args); routeChanged(); return result; };
  }
  window.addEventListener('popstate', routeChanged);
  window.addEventListener('hashchange', routeChanged);
  // Also covers stylesheets/layout changes without DOM mutations.
  setInterval(() => { routeChanged(); if (selected.length || region) publish(); }, 1000);
})();
