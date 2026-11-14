import type { Activity, ConversationEvent, TeamChatMessage } from './api';

type Message = TeamChatMessage & { time: string; createdAt?: number; read?: boolean; readBy?: string[]; completedBy?: string[] };
type View = { messages: Message[]; activities: (Activity & { time: string; createdAt?: number })[] };
const clock = (value: string) => new Intl.DateTimeFormat('en-GB', {hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date(value));

const chronological = <T extends {createdAt?: number}>(items: T[]) => items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

// Background workers persist their events independently of the Leader's SSE.
// Replaying a page or receiving the same event over SSE must remain idempotent.
export function applyConversationEvent<T extends View>(view: T, event: ConversationEvent): T {
  const payload = event.payload;
  if (event.type === 'activity') {
    const activity = payload as Activity;
    const previous = view.activities.find(item => item.id === activity.id);
    if (previous && previous.phase !== 'running' && activity.phase === 'running') return view;
    const createdAt = Math.min(previous?.createdAt ?? Infinity, Date.parse(event.created_at));
    return {...view, activities: chronological(previous
      ? view.activities.map(item => item.id === activity.id ? {...item, ...activity, createdAt} : item)
      : [...view.activities, {...activity, time: clock(event.created_at), createdAt}])};
  }
  if (event.type === 'chat_message') {
    const message = payload as TeamChatMessage;
    if (view.messages.some(item => item.id === message.id)) return view;
    return {...view, messages: chronological([...view.messages, {...message, readBy: [], completedBy: [], time: clock(event.created_at), createdAt: Date.parse(event.created_at)}])};
  }
  if (event.type === 'read_receipt' || event.type === 'message_reaction') {
    return {...view, messages: view.messages.map(item => {
      if (item.id !== payload.message_id) return item;
      if (event.type === 'read_receipt') return {...item, read: item.read || item.mention === payload.reader,
        readBy: [...new Set([...(item.readBy || []), String(payload.reader)])]};
      return {...item, completedBy: [...new Set([...(item.completedBy || []), String(payload.worker)])]};
    })};
  }
  // Assistant deltas belong exclusively to the live stream: a stored partial
  // snapshot must never be appended twice or overwrite newer text.
  return view;
}
