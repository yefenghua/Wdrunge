/** Regression for preview refresh with cached static resources. No backend or model calls. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WDRUNGE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.WDRUNGE_TEST_UI || 'http://127.0.0.1:1420';
let color = 'rgb(220, 20, 60)', scriptVersion = 'one', brokenStylesheet = false;
const counts = { css: 0, script: 0, pageStarts: 0, sideEffects: 0, unexpectedApiGets: 0 };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/style.css') {
    counts.css++;
    res.setHeader('Content-Type', 'text/css');
    res.setHeader('Cache-Control', 'public,max-age=3600');
    if (brokenStylesheet) { res.writeHead(503); res.end('temporary stylesheet failure'); return; }
    res.end(`#title { color: ${color}; }`); return;
  }
  if (path === '/app.js') {
    counts.script++;
    res.setHeader('Content-Type', 'text/javascript');
    res.setHeader('Cache-Control', 'public,max-age=3600');
    res.end(`window.fixtureScriptVersion=${JSON.stringify(scriptVersion)};`); return;
  }
  if (path === '/api/page-start') {
    counts.pageStarts++; res.setHeader('Cache-Control', 'no-store'); res.end('ok'); return;
  }
  if (path === '/api/side-effect') {
    if (req.method === 'POST') counts.sideEffects++;
    else counts.unexpectedApiGets++;
    res.setHeader('Cache-Control', 'no-store'); res.end('ok'); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(`<!doctype html><html><head><link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script><script src="${base}/visual-inspector.js" defer></script></head><body><h1 id="title">刷新验证</h1><script>
    const visit=crypto.randomUUID();
    Promise.all([fetch('/api/page-start?visit='+visit),fetch('/api/side-effect',{method:'POST',body:visit})]).then(()=>window.fixtureBooted=true);
  </script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const target = `http://127.0.0.1:${server.address().port}/blog?tab=design#posts`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.WDRUNGE_TEST_BROWSER ? { channel: process.env.WDRUNGE_TEST_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${base}/dev/visual-feedback.html`);
  const frame = page.frameLocator('iframe');
  async function waitForState(expectedColor, expectedScript) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const state = await frame.locator('#title').evaluate(element => ({ color: getComputedStyle(element).color,
          script: window.fixtureScriptVersion, booted: window.fixtureBooted }));
        if (state.color === expectedColor && state.script === expectedScript && state.booted) return;
      } catch { /* A refresh can replace the frame while polling. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Preview did not reach ${expectedColor} / ${expectedScript} after refresh`);
  }
  async function open() {
    await page.getByLabel('Preview URL').fill(target);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByText('Connected — select an element', { exact: true }).waitFor();
    await frame.locator('#title').evaluate(() => new Promise(resolve => {
      const poll = () => window.fixtureBooted ? resolve(true) : setTimeout(poll, 10); poll();
    }));
  }
  const actualColor = () => frame.locator('#title').evaluate(element => getComputedStyle(element).color);
  await open();
  assert.equal(await actualColor(), 'rgb(220, 20, 60)');
  assert.equal(await frame.locator('#title').evaluate(() => window.fixtureScriptVersion), 'one');
  const firstCssRequests = counts.css;
  color = 'rgb(22, 163, 74)'; scriptVersion = 'two';
  // Opening the unchanged URL rebuilds the iframe, but fresh max-age CSS/JS stay cached.
  await open();
  assert.equal(await actualColor(), 'rgb(220, 20, 60)', 'the fixture must reproduce stale CSS before testing the fix');
  assert.equal(counts.css, firstCssRequests, 'plain remount must retain the cached stylesheet');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await waitForState('rgb(22, 163, 74)', 'two');
  await page.getByText('Connected — select an element', { exact: true }).waitFor();
  assert.equal(await actualColor(), 'rgb(22, 163, 74)');
  assert.equal(await frame.locator('#title').evaluate(() => window.fixtureScriptVersion), 'two');
  assert.ok(counts.css > firstCssRequests, 'refresh must request the new CSS');
  assert.ok(counts.script > 1, 'refresh must request new JS instead of refreshing only the HTML');
  assert.equal(await page.getByLabel('Preview URL').inputValue(), target, 'route, query and fragment remain unchanged');
  assert.equal(await frame.locator('#title').evaluate(() => location.href), target);
  assert.equal(counts.unexpectedApiGets, 0, 'resource prefetch must not replay application API requests');
  assert.equal(counts.sideEffects, counts.pageStarts, 'only normal document execution may run the side-effect API');

  // A failed CSS reload must be surfaced, and a subsequent refresh must recover.
  brokenStylesheet = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /refresh|asset|503|stylesheet/i }).first().waitFor({ timeout: 15000 });
  brokenStylesheet = false; color = 'rgb(37, 99, 235)'; scriptVersion = 'three';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await waitForState('rgb(37, 99, 235)', 'three');
  await page.getByText('Connected — select an element', { exact: true }).waitFor();
  assert.equal(await actualColor(), 'rgb(37, 99, 235)');
  assert.equal(counts.unexpectedApiGets, 0);
  console.log('PASS: cached CSS and JS refresh, route/query/hash preservation, API exclusion, refresh failure and retry');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
