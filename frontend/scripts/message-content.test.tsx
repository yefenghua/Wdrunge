import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import MessageContent from '../src/MessageContent';
import { requestsForTurn, reviewProgress } from '../src/DeliveryProgress';

const render = (content: string, extra = {}) => renderToStaticMarkup(<MessageContent message={{ id: 'message', sender: 'leader', content, ...extra }} />);

test('delivery progress follows accepted collaboration requests from the current user turn', () => {
  const requests = requestsForTurn([
    { conversation: 'chat', origin_message: 'old', created: 1, recipient: 'testing', state: 'completed' },
    { conversation: 'chat', origin_message: 'current', created: 2, recipient: 'frontend', state: 'completed' },
    { conversation: 'chat', origin_message: 'current', created: 3, recipient: 'testing', verification: 'end_to_end', state: 'completed' },
  ], 'chat', 'current', 1_500);
  assert.equal(requests.length, 2);
  assert.deepEqual(reviewProgress(requests, false, false), { checking: false, accepted: true });
});

test('delivery progress does not treat an unfinished or cancelled-only batch as accepted', () => {
  assert.deepEqual(reviewProgress([{ state: 'review', recipient: 'testing' }], false, false), { checking: true, accepted: false });
  assert.deepEqual(reviewProgress([{ state: 'cancelled', recipient: 'frontend' }], false, false), { checking: false, accepted: false });
});

test('renders delivery documents with headings, lists, GFM tables, tasks, links and code', () => {
  const html = render('# 交付材料\n\n**已完成**，~~旧方案~~\n\n- [x] 接口对接\n- [ ] 联调\n\n| 文件 | 状态 |\n| --- | --- |\n| App.tsx | 完成 |\n\n> 注意兼容性\n\n[文档](https://example.com)\n\n```ts\nconst element = "<div>";\n```');
  for (const fragment of ['<h1>交付材料</h1>', '<strong>已完成</strong>', '<del>旧方案</del>', 'type="checkbox"', 'checked=""', '<table>', '<th>文件</th>', '<blockquote>', 'target="_blank"', 'rel="noopener noreferrer"', 'class="language-ts"', '&lt;div&gt;']) assert.ok(html.includes(fragment), fragment);
});

test('keeps multi-worker mentions and independent read receipts around Markdown summaries', () => {
  const html = render('stored legacy text', { mentions: [
    { worker: 'frontend', name: '前端开发', summary: '**完成页面**\n\n- 支持移动端' },
    { worker: 'backend', name: '后端开发', summary: '检查 `GET /api/team`' },
  ], readBy: ['frontend'] });
  assert.ok(html.includes('@林青禾（前端开发）'));
  assert.ok(html.includes('aria-label="林青禾（前端开发）已读"'));
  assert.ok(html.includes('aria-label="陆野（后端开发）未读"'));
  assert.ok(html.includes('<strong>完成页面</strong>'));
  assert.ok(html.includes('<code>GET /api/team</code>'));
  assert.equal((html.match(/class="mention-token"/g) || []).length, 2);
  assert.ok(!html.includes('stored legacy text'));
});

test('preserves role-only single mentions in saved conversations without losing their body', () => {
  const html = render('@后端开发 **检查接口**\n\n```json\n{"ok":true}\n```', { mention: 'backend', read: true });
  assert.ok(html.includes('@陆野（后端开发）'));
  assert.ok(html.includes('aria-label="陆野（后端开发）已读"'));
  assert.ok(html.includes('<strong>检查接口</strong>'));
  assert.ok(html.includes('language-json'));
});

test('ordinary @ text and code do not acquire fabricated read receipts', () => {
  const html = render('联系 @林青禾（前端开发）\n下一行\n\n`@陆野（后端开发）`');
  assert.ok(html.includes('@林青禾（前端开发）'));
  assert.ok(html.includes('<br/>'));
  assert.ok(html.includes('<code>@陆野（后端开发）</code>'));
  assert.ok(!html.includes('read-indicator'));
});

test('does not execute raw HTML or unsafe Markdown links', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[click](javascript:alert%281%29)');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('onerror'));
  assert.ok(!html.includes('javascript:'));
});

test('tolerates incomplete Markdown arriving in streaming chunks', () => {
  const document = '# 结果\n\n**完成**\n\n```ts\nconst result = true;\n```\n\n| 状态 |\n| --- |\n| 完成 |';
  for (let i = 0; i <= document.length; i++) assert.doesNotThrow(() => render(document.slice(0, i)));
  assert.ok(render(document).includes('<table>'));
});

// Real background-worker events arrive while the Leader SSE is still waiting.
import { applyConversationEvent } from '../src/conversationEvents';
test('background log replay preserves streamed text and deduplicates tool phases and mentions', () => {
  const at = '2026-10-01T04:00:00Z';
  let view = { messages: [{id:'reply', sender:'leader', content:'正在组织', time:'12:00'}], activities: [] };
  const start = {sequence:1, type:'activity', created_at:at, payload:{id:'tool',agent:'product',tool:'read_project_file',description:'读取项目文件',phase:'running'}};
  view = applyConversationEvent(view, start);
  view = applyConversationEvent(view, {...start, sequence:2, payload:{...start.payload, phase:'completed'}});
  view = applyConversationEvent(view, start);
  const chat = {sequence:3, type:'chat_message', created_at:at, payload:{id:'mention',sender:'frontend',content:'@后端 接口已接入',mentions:[{worker:'backend',name:'后端',summary:'接口已接入'}]}};
  view = applyConversationEvent(applyConversationEvent(view, chat), chat);
  view = applyConversationEvent(view, {sequence:4,type:'assistant_completed',created_at:at,payload:{id:'reply',content:'stale'}});
  assert.equal(view.messages[0].content, '正在组织');
  assert.equal(view.messages.length, 2);
  assert.equal(view.activities.length, 1);
  assert.equal((view.activities[0] as {phase:string}).phase, 'completed');
});

test('public mention replies render a short summary and never their detailed payload', () => {
  const html = render('完整内部交接参数不应出现在群里', {sender:'backend', mentions:[{worker:'frontend', name:'前端', summary:'接口契约已更新，请重新生成客户端。'}]});
  assert.ok(html.includes('接口契约已更新，请重新生成客户端。'));
  assert.ok(html.includes('@林青禾（前端开发）'));
  assert.ok(!html.includes('完整内部交接参数'));
});

import { formatTokens } from '../src/formatTokens';
test('token totals use compact units and promote rounded unit boundaries', () => {
  for (const [input, expected] of [[0, '0'], [999, '999'], [1000, '1.0k'], [12500, '12.5k'],
    [999949, '999.9k'], [999950, '1.0m'], [1000000, '1.0m'], [1500000000, '1.5b']] as const) {
    assert.equal(formatTokens(input), expected);
  }
});
