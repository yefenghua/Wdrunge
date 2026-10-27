import { useState } from 'react';

export type Goal = {
  id: string; objective: string; criteria: string[]; state: string;
  conversation: string; reason: string; evidence: Record<string, string>;
  next_reminder_at: number; reminder_count: number; scale?: string | null;
};
const scaleLabels: Record<string, string> = { small: '小型', medium: '中型', large: '大型' };
const scaleOptions = [
  { value: '', label: '不限定', note: '按实际需求' },
  { value: 'small', label: '小型', note: '每项最多 3 条' },
  { value: 'medium', label: '中型', note: '目标 6 条 · 任务 5 条' },
  { value: 'large', label: '大型', note: '最多 8 条' },
];
type Task = { id: string; goal_id?: string; state: string; summary?: string; goal?: string };

export function AcceptanceForm({ criteria, busy, onAccept, label = '确认验收' }: {
  criteria: string[]; busy: boolean; onAccept: (evidence: Record<string, string>) => void; label?: string;
}) {
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  return <form className="goal-evidence" onSubmit={e => { e.preventDefault(); onAccept(evidence); }}>
    {criteria.map(criterion => <label key={criterion}>{criterion}<textarea required maxLength={4000}
      placeholder="填写检查结果、测试或交付证据" value={evidence[criterion] || ''}
      onChange={e => setEvidence({ ...evidence, [criterion]: e.target.value })} /></label>)}
    <button disabled={busy || criteria.some(c => !evidence[c]?.trim())}>{label}</button>
  </form>;
}

export default function GoalPanel({ goals, tasks, busy, command, act }: {
  goals: Goal[]; tasks: Task[]; busy: boolean;
  command: (action: string, payload: object) => Promise<unknown>;
  act: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [objective, setObjective] = useState('');
  const [criteria, setCriteria] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [scale, setScale] = useState('');
  const labels: Record<string, string> = { active: '进行中', paused: '已暂停', blocked: '需要处理', completed: '已完成', cancelled: '已取消' };
  const change = (g: Goal, state: string, reason: string) => void act(async () => {
    await command('update_goal', { identifier: g.id, state, reason });
  });
  return <section aria-label="长期目标" className="goal-panel">
    <h3>长期目标</h3>
    <details><summary>创建目标</summary><form className="goal-evidence" onSubmit={e => {
      e.preventDefault(); void act(async () => {
        await command('create_goal', { objective, criteria: criteria.split('\n').map(s => s.trim()).filter(Boolean), key, ...(scale ? { scale } : {}) });
        setObjective(''); setCriteria(''); setKey(crypto.randomUUID()); setScale('');
      });
    }}><label>目标<textarea required maxLength={4000} value={objective} onChange={e => { setObjective(e.target.value); setKey(crypto.randomUUID()); }} /></label>
      <label>验收条件（每行一项，最多 8 项）<textarea required value={criteria} onChange={e => { setCriteria(e.target.value); setKey(crypto.randomUUID()); }} /></label>
      <fieldset className="goal-scale">
        <legend>任务规模</legend>
        <p>控制验收项数量，并同步成员的交付范围</p>
        <div className="goal-scale-options">
          {scaleOptions.map(option => <label className={scale === option.value ? 'selected' : ''} key={option.value || 'unlimited'}>
            <input type="radio" name="goal-scale" value={option.value} checked={scale === option.value}
              onChange={() => { setScale(option.value); setKey(crypto.randomUUID()); }} />
            <span>{option.label}</span><small>{option.note}</small>
          </label>)}
        </div>
      </fieldset>
      <button disabled={busy || !objective.trim() || !criteria.trim()}>创建并持续跟进</button>
    </form></details>
    {!goals.length && <p className="collaboration-empty">暂无目标。多步任务可通过目标持续跟进和逐项验收。</p>}
    {goals.map(g => {
      const own = tasks.filter(t => t.goal_id === g.id);
      const completed = own.filter(t => t.state === 'completed').length;
      const terminal = ['completed', 'cancelled'].includes(g.state);
      return <article key={g.id} className="collaboration-request">
        <div><strong>{g.objective}</strong><span>{labels[g.state] || g.state}{g.scale ? ` · ${scaleLabels[g.scale] || g.scale}` : ''}</span></div>
        <p>任务验收 {completed} / {own.length} · 已提醒 {g.reminder_count} 次</p>
        {g.state === 'active' && <small>下次检查：{new Date(g.next_reminder_at * 1000).toLocaleString()}；需要处理时提醒。</small>}
        {g.reason && <p role="status">{g.reason}</p>}
        <ol>{g.criteria.map(c => <li key={c}>{c}{g.evidence[c] && <p>{g.evidence[c]}</p>}</li>)}</ol>
        {own.map(t => <a className="collaboration-document" key={t.id} href={`#request-${t.id}`}>{t.summary || t.goal || '查看任务'}</a>)}
        {!terminal && <div className="collaboration-controls">
          {g.state === 'active' ? <button disabled={busy} onClick={() => change(g, 'paused', '用户暂停目标')}>暂停目标</button>
            : <button disabled={busy} onClick={() => change(g, 'active', '用户恢复目标并继续处理')}>恢复目标</button>}
          <button disabled={busy} onClick={() => change(g, 'cancelled', '用户取消目标及其未完成任务')}>取消目标</button>
        </div>}
        {g.state === 'active' && own.length > 0 && completed === own.length && <details><summary>验收目标</summary>
          <AcceptanceForm criteria={g.criteria} busy={busy} onAccept={evidence => void act(async () => {
            await command('complete_goal', { identifier: g.id, evidence });
          })} />
        </details>}
      </article>;
    })}
  </section>;
}
