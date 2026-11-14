import type { SessionUsage } from './api';
import { formatTokens } from './formatTokens';

const purposeLabels: Record<string, string> = { work: 'Task execution', coordination: 'Coordination', summary: 'Context summary', review: 'Command review', title: 'Title' };

type Group = SessionUsage['by_agent'][number];

function cache(group: Group) {
  return group.cache_percent == null ? '—' : `${group.cache_percent.toFixed(1)}%`;
}

function Rows({ title, groups, label }: { title: string; groups: Group[]; label: (key: string | null | undefined) => string }) {
  if (!groups.length) return null;
  return <table className="usage-breakdown"><caption>{title}</caption><thead><tr><th></th><th>Calls</th><th>Tokens</th><th>Cache hit</th></tr></thead>
    <tbody>{groups.map(group => <tr key={String(group.key)}><td title={String(group.key ?? '')}>{label(group.key)}</td><td>{group.calls}</td><td>{formatTokens(group.total_tokens)}</td><td>{cache(group)}</td></tr>)}</tbody></table>;
}

export default function SessionUsagePanel({ usage, nameOf, allTokens }: { usage: SessionUsage | null; nameOf: (id: string) => string; allTokens: number }) {
  const totals = usage?.totals;
  return <details className="usage-total session-usage">
    <summary><span>This session</span><strong title={`${(totals?.total_tokens ?? 0).toLocaleString()} tokens`}>{formatTokens(totals?.total_tokens ?? 0)}</strong><small>TOKENS</small>
      <small className="usage-cache" title={totals?.cache_percent == null ? 'The model has not reported cache data yet' : `Cache hit: ${totals.cached_tokens.toLocaleString()} / ${totals.cache_input_tokens.toLocaleString()} input tokens`}>Cache hit {totals ? cache(totals) : '—'}</small></summary>
    {usage && totals && <div className="session-usage-detail">
      <p>Model calls {totals.calls} · Input {formatTokens(totals.input_tokens)} · Output {formatTokens(totals.output_tokens)}{totals.latency_ms != null ? ` · Avg. ${(totals.latency_ms / 1000).toFixed(1)}s` : ''}{totals.retries ? ` · Retries ${totals.retries}` : ''}</p>
      <p>Tool calls {usage.tool_calls.total ?? 0} ({usage.tool_calls.failed ?? 0} failed) · Approvals {usage.approvals.human ?? 0} manual, {(usage.approvals.automatic ?? 0) + (usage.approvals.allow_all ?? 0)} automatic{usage.approvals.pending ? `, ${usage.approvals.pending} pending` : ''}</p>
      <Rows title="By agent" groups={usage.by_agent} label={key => key === 'reviewer' ? 'Command review model' : key === 'title' ? 'Title model' : nameOf(key || '')} />
      <Rows title="By purpose" groups={usage.by_purpose} label={key => purposeLabels[key || ''] || key || 'Unlabeled'} />
      <Rows title="By task" groups={usage.by_task.slice(0, 8)} label={key => key || 'Direct reply'} />
      <small>All sessions: {formatTokens(allTokens)} tokens</small>
    </div>}
  </details>;
}
