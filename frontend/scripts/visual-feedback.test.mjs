/** Local browser regression; all backend/model requests below are mocked. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WDRUNGE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.WDRUNGE_TEST_UI || 'http://127.0.0.1:1420';
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><style>body{margin:20px}#card{width:440px;padding:20px;border:1px solid #ccc}#title{width:240px;height:32px;margin:0 0 20px}#save{display:block;width:100px;height:36px}input{margin-top:30px}</style></head><body><section id="card" data-wdrunge-source="src/Card.tsx:12"><h2 id="title">${req.url === '/next' ? '下一页标题' : '个人博客'}</h2><button id="save" onclick="window.clicked=true">保存文章</button><input type="password" value="private-secret"><div contenteditable="true">private-editable</div></section><a id="next-link" href="/next">下一页</a>${req.url === '/plain' ? '' : `<script src="${base}/visual-inspector.js" defer></script>`}</body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const target = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.WDRUNGE_TEST_BROWSER ? { channel: process.env.WDRUNGE_TEST_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(`${base}/dev/visual-feedback.html`);
  const frame = page.frameLocator('iframe');
  async function open(path = '/') {
    await page.getByLabel('Preview URL').fill(target + path);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
  }
  async function closePopup(surface = page) {
    const close = surface.getByRole('button', { name: 'Close annotation', exact: true });
    if (await close.isVisible()) { await close.click(); await close.waitFor({ state: 'hidden' }); }
  }
  async function select(id, options = {}) {
    await closePopup();
    const before = await page.evaluate(() => ({ version: window.feedbackSelectionVersion,
      selectors: window.feedbackSelection?.elements.map(element => element.selector) || [] }));
    const expected = before.selectors.includes(id) ? before.selectors.filter(selector => selector !== id)
      : options.modifiers?.includes('Shift') ? [...before.selectors, id] : [id];
    await frame.locator(id).click(options);
    // The iframe event crosses postMessage and React effects before the new popup opens.
    // Wait for both the new selection and its rendered popup before the next user action.
    await page.waitForFunction(({ version, expected }) => window.feedbackSelectionVersion > version
      && JSON.stringify(window.feedbackSelection?.elements.map(element => element.selector) || []) === JSON.stringify(expected),
    { version: before.version, expected });
    await page.getByRole('form', { name: 'Selection annotation' }).waitFor({ state: expected.length ? 'visible' : 'hidden' });
  }
  async function add(comment, count) {
    await page.getByLabel('Annotation comment', { exact: true }).fill(comment);
    await page.getByRole('button', { name: 'Add Annotation', exact: true }).click();
    await page.waitForFunction(count => window.feedbackAnnotations.length === count, count);
    await page.getByRole('form', { name: 'Selection annotation' }).waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.feedbackRequests.length), 0, 'saving a comment must not call the model');
  }
  await page.getByLabel('Preview URL').fill('https://example.com');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  await open();
  await page.getByText('Connected — select an element', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Select Area', exact: true }).click();
  await select('#save');
  await page.getByText('Selected button', { exact: true }).waitFor();
  assert.equal(await frame.locator('body').evaluate(() => Boolean(window.clicked)), false);
  assert.equal(await page.locator('.website-annotation').count(), 0, 'no bottom modification form');
  await add('点击后保存文章到数据库，同时把按钮文字加粗', 1);
  const first = await page.evaluate(() => window.feedbackAnnotations[0]);
  assert.match(first.comment, /保存文章到数据库/);
  assert.equal(first.context.elements[0].selector, '#save');
  assert.equal(first.context.elements[0].source, 'src/Card.tsx:12');
  assert.doesNotMatch(JSON.stringify(first), /private-secret|private-editable/);
  await select('#title');
  await page.getByRole('button', { name: 'Select Parent', exact: true }).click();
  await page.getByText('Selected section', { exact: true }).waitFor();
  await add('这个区域背景改成浅蓝色', 2);
  assert.doesNotMatch(await page.evaluate(() => JSON.stringify(window.feedbackAnnotations[1])), /private-secret|private-editable/);
  // Switching targets cannot silently bind an unsaved comment to another element.
  await select('#title');
  await page.getByLabel('Annotation comment', { exact: true }).fill('不应绑定到另一个按钮');
  await select('#save');
  assert.equal(await page.getByLabel('Annotation comment', { exact: true }).inputValue(), '');
  await select('#save');
  await page.waitForFunction(() => !window.feedbackSelection?.elements.length);
  await select('#title');
  await select('#save', { modifiers: ['Shift'] });
  await page.getByText('2 elements selected', { exact: true }).waitFor();
  await add('两个元素统一加粗', 3);
  assert(await page.evaluate(() => Boolean(window.feedbackAnnotations[2].context.commonAncestor)));
  // Add-time snapshot uses current text/styles; disconnected nodes invalidate current selection.
  await select('#title');
  await frame.locator('#title').evaluate(element => { element.textContent = '动态更新标题'; element.style.fontWeight = '900'; });
  await page.locator('.website-selection-list').getByText('h2 · 动态更新标题', { exact: true }).waitFor();
  await add('基于最新标题修改', 4);
  const dynamic = await page.evaluate(() => window.feedbackAnnotations[3]);
  assert.equal(dynamic.context.elements[0].styles.fontWeight, '900');
  assert.equal(dynamic.context.elements[0].text, '动态更新标题');
  await select('#title');
  await frame.locator('#title').evaluate(element => element.replaceWith(Object.assign(document.createElement('h2'), { id: 'title', textContent: '替换后的标题' })));
  await page.getByRole('form', { name: 'Selection annotation' }).waitFor({ state: 'hidden' });
  await select('#title');
  await frame.locator('body').evaluate(() => history.pushState({}, '', '/spa?tab=design'));
  await page.waitForFunction(() => !window.feedbackSelection?.elements.length);
  assert.equal(await page.evaluate(() => window.feedbackAnnotations.length), 4, 'saved notes survive navigation as snapshots');
  await page.waitForFunction(() => document.querySelector('[aria-label="Preview URL"]').value.endsWith('/spa?tab=design'));
  await page.getByLabel('Preview URL').fill(target + '/user-typing');
  const start = Date.now(); await page.waitForFunction(start => Date.now() - start > 1000, start);
  assert.equal(await page.getByLabel('Preview URL').inputValue(), target + '/user-typing');
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await frame.locator('#save').click();
  assert.equal(await frame.locator('body').evaluate(() => window.clicked), true);
  await frame.locator('#next-link').click();
  await page.getByText('Connected — select an element', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Preview URL"]').value.endsWith('/next'));
  await page.getByRole('button', { name: 'Select Area', exact: true }).click();
  // Genuine drag in the same mode; popup and bottom form are not needed to start it.
  const titleBox = await frame.locator('#title').boundingBox(), buttonBox = await frame.locator('#save').boundingBox();
  await page.mouse.move(titleBox.x - 3, titleBox.y - 3); await page.mouse.down();
  await page.mouse.move(titleBox.x + titleBox.width + 3, buttonBox.y + buttonBox.height + 3, { steps: 10 }); await page.mouse.up();
  await page.getByText('Region selected · 2 elements', { exact: true }).waitFor();
  await add('这个区域增加间距', 5);
  const region = await page.evaluate(() => window.feedbackAnnotations[4]);
  assert(region.context.region); assert.equal(region.context.elements.length, 2);
  assert.doesNotMatch(JSON.stringify(region), /private-secret|private-editable/);
  const jitter = await frame.locator('#title').boundingBox();
  await page.mouse.move(jitter.x + 20, jitter.y + 10); await page.mouse.down();
  await page.mouse.move(jitter.x + 22, jitter.y + 11); await page.mouse.up();
  await page.getByText('Selected h2', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('Connected — select an element', { exact: true }).waitFor();
  await page.evaluate(() => window.postMessage({ type: 'wdrunge:selection', token: 'fake', pageId: 'fake', context: {} }, '*'));
  assert.equal(await page.getByRole('form', { name: 'Selection annotation' }).count(), 0);
  await open('/plain');
  assert.equal(await page.getByRole('button', { name: 'Select Area', exact: true }).isDisabled(), true);
  await page.getByText('Can browse but not select? Add the selection script', { exact: true }).click();
  await page.getByRole('button', { name: 'Ask Agent to Add It', exact: true }).click();
  await page.waitForFunction(() => window.feedbackRequests.length === 1);
  assert.match(await page.evaluate(() => window.feedbackRequests[0]), /development only/);
  const checks = await page.evaluate(() => {
    const { localPreviewUrl, parseSelection, annotationRequest } = window.feedbackTest;
    const bad = ['javascript:alert(1)', 'http://evil.test', 'http://localhost.evil.test', 'http://a:b@localhost:8101'].every(value => {
      try { localPreviewUrl(value); return false; } catch { return true; }
    });
    let oversized = false; try { annotationRequest('x'.repeat(20000), window.feedbackAnnotations); } catch { oversized = true; }
    return { bad, oversized, malformed: parseSelection({ url: 'http://localhost', rect: {} }) };
  });
  assert(checks.bad); assert(checks.oversized); assert.equal(checks.malformed, null);
  // Production App: adding notes never sends; chat combines all notes into one request.
  const app = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const submissions = []; let failNext = false;
  let execution = { running: false, paused: false, stopping: false, pending_tasks: 0, active_goals: 0, task_states: {} };
  const timestamp = new Date().toISOString();
  const conversations = ['visual-chat', 'other-chat'].map((id, index) => ({ id, project_id: 'visual-project', title: index ? 'Other chat' : 'Visual test', status: 'idle', created_at: timestamp, updated_at: timestamp }));
  const project = { id: 'visual-project', name: 'Visual test', workspace_path: 'E:/demo', created_at: timestamp, updated_at: timestamp, conversations };
  await app.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST' } });
    if (path.endsWith('/messages/stream')) {
      submissions.push({ path, ...request.postDataJSON() });
      if (failNext) { failNext = false; return route.fulfill({ status: 500, headers, contentType: 'application/json', body: '{"detail":"mock send failure"}' }); }
      return route.fulfill({ headers, contentType: 'text/event-stream', body: 'event: delta\ndata: {"content":"已收到修改要求","message_id":"reply"}\n\nevent: done\ndata: {}\n\n' });
    }
    let body = {};
    if (path === '/api/projects') body = [project];
    else if (path === '/api/team') body = { agents: [] };
    else if (path.endsWith('/events')) body = { events: [], cursor: 0, has_more: false };
    else if (path.endsWith('/execution')) body = execution;
    else if (/\/api\/conversations\/[^/]+$/.test(path)) {
      const chat = conversations.find(item => path.endsWith('/' + item.id));
      body = { ...chat, project_name: project.name, workspace_path: project.workspace_path, activities: [], messages: [] };
    } else if (path.includes('/delivery/')) body = { entries: [], revision: 'test', truncated: false };
    return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await app.goto(base);
  async function openPreview() {
    await app.getByRole('button', { name: 'Site Preview ↗', exact: true }).click();
    await app.getByLabel('Preview URL').fill(target);
    await app.getByRole('button', { name: 'Open', exact: true }).click();
    await app.getByText('Connected — select an element', { exact: true }).waitFor();
    await app.getByRole('button', { name: 'Select Area', exact: true }).click();
  }
  async function appNote(id, comment) {
    await closePopup(app); await app.frameLocator('iframe').locator(id).click();
    await app.getByLabel('Annotation comment', { exact: true }).fill(comment);
    await app.getByRole('button', { name: 'Add Annotation', exact: true }).click();
    await app.getByRole('form', { name: 'Selection annotation' }).waitFor({ state: 'hidden' });
  }
  await app.getByLabel('Message the team…', { exact: true }).fill('整体保持简洁');
  await openPreview();
  await appNote('#title', '标题改成蓝色');
  await appNote('#save', '保存按钮加粗');
  await app.getByText('2 annotations', { exact: false }).waitFor();
  assert.equal(submissions.length, 0);
  assert.equal(await app.getByLabel('Message the team…', { exact: true }).inputValue(), '整体保持简洁');
  await app.getByLabel('Edit annotation 2', { exact: true }).fill('保存按钮加粗并增大圆角');
  await app.locator('.prompt-control > summary').filter({ hasText: 'Interface Style' }).click();
  await app.getByRole('button', { name: 'Clean & minimal', exact: true }).click();
  if (process.env.WDRUNGE_TEST_SCREENSHOT) {
    await app.frameLocator('iframe').locator('#card').click({ position: { x: 430, y: 180 } });
    await app.getByRole('form', { name: 'Selection annotation' }).waitFor();
    await app.screenshot({ path: process.env.WDRUNGE_TEST_SCREENSHOT });
    await app.getByRole('button', { name: 'Remove current selection', exact: true }).click();
  }
  await app.getByRole('button', { name: 'Send', exact: true }).click();
  await app.waitForFunction(() => !document.querySelector('.annotation-drafts'));
  assert.equal(submissions.length, 1);
  assert(submissions[0].client_message_id);
  assert.match(submissions[0].content, /整体保持简洁/);
  assert.match(submissions[0].content, /Interface Style: Clean & minimal/);
  assert.match(submissions[0].content, /标题改成蓝色/);
  assert.match(submissions[0].content, /保存按钮加粗并增大圆角/);
  assert.match(submissions[0].content, /#title/); assert.match(submissions[0].content, /#save/);
  assert.doesNotMatch(submissions[0].content, /private-secret|private-editable/);
  assert.equal(await app.getByLabel('Message the team…', { exact: true }).inputValue(), '');
  // Annotation-only messages are valid; deletion affects the actual payload.
  await appNote('#title', '删除后不能发送的意见');
  await app.getByRole('button', { name: 'Delete annotation 1', exact: true }).click();
  await appNote('#save', '只发送批注也可以');
  await app.getByRole('button', { name: 'Send', exact: true }).click();
  await app.waitForFunction(() => !document.querySelector('.annotation-drafts'));
  assert.equal(submissions.length, 2);
  assert.match(submissions[1].content, /只发送批注也可以/);
  assert.doesNotMatch(submissions[1].content, /删除后不能发送的意见/);
  // Failed request preserves annotations and normal text for retry.
  await appNote('#title', '失败后保留的标题批注');
  await app.getByLabel('Message the team…', { exact: true }).fill('失败后保留的群聊草稿');
  failNext = true;
  await app.getByRole('button', { name: 'Send', exact: true }).click();
  await app.getByRole('alert').filter({ hasText: /mock send failure|500|failed|Could not/i }).first().waitFor();
  assert.equal(submissions.length, 3);
  assert.equal(await app.getByLabel('Edit annotation 1', { exact: true }).inputValue(), '失败后保留的标题批注');
  assert.equal(await app.getByLabel('Message the team…', { exact: true }).inputValue(), '失败后保留的群聊草稿');
  await app.getByRole('button', { name: 'Send', exact: true }).click();
  await app.waitForFunction(() => !document.querySelector('.annotation-drafts'));
  assert.equal(submissions.length, 4);
  // An unsaved current selection can go directly with the chat, using a fresh snapshot.
  await app.frameLocator('iframe').locator('#save').click();
  await app.getByText('Current selection', { exact: false }).first().waitFor();
  await closePopup(app);
  await app.getByLabel('Message the team…', { exact: true }).fill('直接修改当前选区');
  await app.frameLocator('iframe').locator('#save').evaluate(element => element.style.fontWeight = '900');
  await app.getByRole('button', { name: 'Send', exact: true }).click();
  await app.waitForFunction(() => !document.querySelector('.annotation-drafts'));
  assert.equal(submissions.length, 5);
  assert.match(submissions[4].content, /currentSelection/);
  assert.match(submissions[4].content, /"fontWeight":"900"/);
  // Saved annotation drafts are scoped to their conversation.
  await appNote('#title', '只属于第一个会话');
  await app.getByRole('button', { name: /Other chat/ }).click();
  await app.getByLabel('Message the team…', { exact: true }).waitFor();
  assert.equal(await app.getByLabel('Edit annotation 1', { exact: true }).count(), 0);
  await app.locator('.history-item').filter({ hasText: 'Visual test' }).click();
  await app.getByLabel('Edit annotation 1', { exact: true }).waitFor();
  assert.equal(await app.getByLabel('Edit annotation 1', { exact: true }).inputValue(), '只属于第一个会话');
  assert.equal(submissions.length, 5);
  execution = { ...execution, running: true, pending_tasks: 1, task_states: { review: 1 } };
  await app.getByText('Code delivered · 1 awaiting Leader review', { exact: true }).waitFor();
  execution = { ...execution, running: false, pending_tasks: 0, task_states: {} };
  await app.waitForFunction(() => !document.querySelector('.processing'));
  console.log('PASS: floating comments, continuous point/drag selection, live DOM, navigation, private fields, setup and URL validation');
  console.log('PASS: batch annotations plus chat text use one mocked stream request; annotation-only send, edit/delete, failure retention and per-chat drafts');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
