import { useState } from 'react';

export type Goal = {
  id: string; objective: string; criteria: string[]; state: string;
  conversation: string; reason: string; evidence: Record<string, string>;
  next_reminder_at: number; reminder_count: number; scale?: string | null;
  requirements?: { document?: string; none?: string } | null;
};
const scaleLabels: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const scaleOptions = [
  { value: '', label: 'Any size', note: 'As needed' },
  { value: 'small', label: 'Small', note: 'Up to 3 each' },
  { value: 'medium', label: 'Medium', note: '6 per goal · 5 per task' },
  { value: 'large', label: 'Large', note: 'Up to 8' },
];
type Task = { id: string; goal_id?: string; state: string; summary?: string; goal?: string };

export function AcceptanceForm({ criteria, busy, onAccept, label = 'Approve' }: {
  criteria: string[]; busy: boolean; onAccept: (evidence: Record<string, string>) => void; label?: string;
}) {
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  return <form className="goal-evidence" onSubmit={e => { e.preventDefault(); onAccept(evidence); }}>
    {criteria.map(criterion => <label key={criterion}>{criterion}<textarea required maxLength={4000}
      placeholder="Add check results, tests, or delivery evidence" value={evidence[criterion] || ''}
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
  const labels: Record<string, string> = { active: 'Active', paused: 'Paused', blocked: 'Needs attention', completed: 'Completed', cancelled: 'Canceled' };
  const change = (g: Goal, state: string, reason: string) => void act(async () => {
    await command('update_goal', { identifier: g.id, state, reason });
  });
  return <section aria-label="Long-term goals" className="goal-panel">
    <h3>Long-term goals</h3>
    <details><summary>Create goal</summary><form className="goal-evidence" onSubmit={e => {
      e.preventDefault(); void act(async () => {
        await command('create_goal', { objective, criteria: criteria.split('\n').map(s => s.trim()).filter(Boolean), key, ...(scale ? { scale } : {}) });
        setObjective(''); setCriteria(''); setKey(crypto.randomUUID()); setScale('');
      });
    }}><label>Objective<textarea required maxLength={4000} value={objective} onChange={e => { setObjective(e.target.value); setKey(crypto.randomUUID()); }} /></label>
      <label>Acceptance criteria (up to 8, one per line)<textarea required value={criteria} onChange={e => { setCriteria(e.target.value); setKey(crypto.randomUUID()); }} /></label>
      <fieldset className="goal-scale">
        <legend>Task size</legend>
        <p>Set the criteria limit and share the delivery scope with the team.</p>
        <div className="goal-scale-options">
          {scaleOptions.map(option => <label className={scale === option.value ? 'selected' : ''} key={option.value || 'unlimited'}>
            <input type="radio" name="goal-scale" value={option.value} checked={scale === option.value}
              onChange={() => { setScale(option.value); setKey(crypto.randomUUID()); }} />
            <span>{option.label}</span><small>{option.note}</small>
          </label>)}
        </div>
      </fieldset>
      <button disabled={busy || !objective.trim() || !criteria.trim()}>Create &amp; track</button>
    </form></details>
    {!goals.length && <p className="collaboration-empty">No goals yet. Use a goal to track multi-step work and review each criterion.</p>}
    {goals.map(g => {
      const own = tasks.filter(t => t.goal_id === g.id);
      const completed = own.filter(t => t.state === 'completed').length;
      const terminal = ['completed', 'cancelled'].includes(g.state);
      return <article key={g.id} className="collaboration-request">
        <div><strong>{g.objective}</strong><span>{labels[g.state] || g.state}{g.scale ? ` · ${scaleLabels[g.scale] || g.scale}` : ''}</span></div>
        <p>Tasks accepted {completed} / {own.length} · Reminders {g.reminder_count}</p>
        {g.state === 'active' && <small>Next check {new Date(g.next_reminder_at * 1000).toLocaleString('en-GB')} · A reminder appears if action is needed.</small>}
        {g.requirements?.document && <small>Requirements doc · {g.requirements.document}</small>}
        {g.requirements?.none && <small>No requirements doc · {g.requirements.none}</small>}
        {g.reason && <p role="status">{g.reason}</p>}
        <ol>{g.criteria.map(c => <li key={c}>{c}{g.evidence[c] && <p>{g.evidence[c]}</p>}</li>)}</ol>
        {own.map(t => <a className="collaboration-document" key={t.id} href={`#request-${t.id}`}>{t.summary || t.goal || 'View task'}</a>)}
        {!terminal && <div className="collaboration-controls">
          {g.state === 'active' ? <button disabled={busy} onClick={() => change(g, 'paused', 'User paused the goal')}>Pause goal</button>
            : <button disabled={busy} onClick={() => change(g, 'active', 'User resumed work on the goal')}>Resume goal</button>}
          <button disabled={busy} onClick={() => change(g, 'cancelled', 'User canceled the goal and its unfinished tasks')}>Cancel goal</button>
        </div>}
        {g.state === 'active' && own.length > 0 && completed === own.length && <details><summary>Review goal</summary>
          <AcceptanceForm criteria={g.criteria} busy={busy} onAccept={evidence => void act(async () => {
            await command('complete_goal', { identifier: g.id, evidence });
          })} />
        </details>}
      </article>;
    })}
  </section>;
}
