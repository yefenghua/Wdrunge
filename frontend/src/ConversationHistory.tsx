import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConversationSummary, ProjectSummary } from "./api";
import { displayConversationTitle } from "./conversationTitle";

const priorities = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
] as const;
type Priority = typeof priorities[number]["value"];
type Preference = { pinned: boolean; priority: Priority };
type HistoryPreferences = Record<string, Preference | undefined>;

export const conversationPreferencesKey = "wdrunge.conversation-history.v1";
const defaultPreference: Preference = { pinned: false, priority: "normal" };
const priorityRank: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export function parseHistoryPreferences(value: string | null): HistoryPreferences {
  try {
    const saved: unknown = value ? JSON.parse(value) : null;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).flatMap(([id, entry]) => {
      if (!entry || typeof entry !== "object") return [];
      const pinned = entry.pinned === true;
      const priority = entry.priority === "high" || entry.priority === "low" ? entry.priority : "normal";
      return pinned || priority !== "normal" ? [[id, { pinned, priority }]] : [];
    }));
  } catch {
    return {};
  }
}

export function orderConversations<T extends { id: string }>(conversations: readonly T[], preferences: HistoryPreferences): T[] {
  return [...conversations].sort((left, right) => {
    const a = preferences[left.id] ?? defaultPreference;
    const b = preferences[right.id] ?? defaultPreference;
    // Stable sort preserves the backend's most-recent-first order for ties.
    return Number(b.pinned) - Number(a.pinned) || priorityRank[a.priority] - priorityRank[b.priority];
  });
}

function ConversationRow({ conversation, selected, preference, open, onToggle, onClose, onOpen, onPreference }: {
  conversation: ConversationSummary;
  selected: boolean;
  preference: Preference;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpen: () => void;
  onPreference: (preference: Preference) => void;
}) {
  const entry = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const optionsId = `history-options-${conversation.id}`;
  const title = displayConversationTitle(conversation.title);
  const priorityLabel = priorities.find(({ value }) => value === preference.priority)?.label;
  const status = [preference.pinned && "Pinned", preference.priority !== "normal" && `${priorityLabel} priority`].filter(Boolean).join(", ");

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!entry.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, onClose]);
  useLayoutEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  function dismissWithFocus() {
    restoreFocus.current = true;
    onClose();
  }

  function selectPreference(next: Preference) {
    onPreference(next);
    dismissWithFocus();
  }

  return <div className="history-entry" ref={entry} onKeyDown={event => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissWithFocus();
    }
  }}>
    <div className={selected ? "history-row selected" : "history-row"}>
      <button type="button" className={selected ? "history-item selected" : "history-item"} title={title}
        aria-label={status ? `${title}, ${status}` : undefined} aria-current={selected ? "true" : undefined} onClick={onOpen}>
        <svg className="history-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {preference.pinned
            ? <path d="m9.4 2.6 4 4-1.6.7-1.5 2.5-1.1 1.1-4.1-4.1 1.1-1.1 2.5-1.5.7-1.6ZM7 9l-4 4" />
            : <path d="M3 3.5h10v7H7l-3 2v-2H3v-7Z" />}
        </svg>
        <span className="history-title">{title}</span>
        {preference.priority !== "normal" && <small className={`history-priority ${preference.priority}`}
          title={`${priorityLabel} priority`} aria-hidden="true">{priorityLabel}</small>}
      </button>
      <button type="button" className="history-more" ref={trigger} aria-label={`Options for ${title}`}
        title="Chat options" aria-expanded={open} aria-controls={open ? optionsId : undefined} onClick={onToggle}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="12.5" cy="8" r="1" />
        </svg>
      </button>
    </div>
    {open && <div id={optionsId} className="history-options">
      <button type="button" className="history-pin-action" aria-pressed={preference.pinned}
        onClick={() => selectPreference({ ...preference, pinned: !preference.pinned })}>
        {preference.pinned ? "Unpin chat" : "Pin chat"}
      </button>
      <div className="history-priorities" role="group" aria-label="Chat priority">
        <span>Priority</span>
        {priorities.map(({ value, label }) => <button type="button" key={value} aria-label={`${label} priority`}
          aria-pressed={preference.priority === value} onClick={() => selectPreference({ ...preference, priority: value })}>{label}</button>)}
      </div>
    </div>}
  </div>;
}

export default function ConversationHistory({ projects, search, loading, activeProject, activeConversation, creating,
  onOpenProject, onOpenConversation, onCreate }: {
  projects: ProjectSummary[];
  search: string;
  loading: boolean;
  activeProject?: string;
  activeConversation?: string;
  creating: boolean;
  onOpenProject: (project: string, conversation?: string) => void;
  onOpenConversation: (conversation: string) => void;
  onCreate: (project: string) => void;
}) {
  const [preferences, setPreferences] = useState<HistoryPreferences>(() => {
    try { return parseHistoryPreferences(window.localStorage.getItem(conversationPreferencesKey)); }
    catch { return {}; }
  });
  const [openOptions, setOpenOptions] = useState<string | null>(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(conversationPreferencesKey, JSON.stringify(preferences));
    } catch { /* Storage may be disabled in the browser. */ }
  }, [preferences]);

  const query = search.toLowerCase();
  const visibleProjects = projects.flatMap(project => {
    const projectMatches = project.name.toLowerCase().includes(query);
    const conversations = projectMatches ? project.conversations
      : project.conversations.filter(conversation => displayConversationTitle(conversation.title).toLowerCase().includes(query));
    return projectMatches || conversations.length ? [{ ...project, conversations }] : [];
  });

  return <nav className="project-list" aria-label="Projects">
    {visibleProjects.map(project => <section className={`project-group ${project.id === activeProject ? "selected" : ""}`} key={project.id}>
      <div className="project-row">
        <button type="button" className="project-name" title={project.workspace_path}
          onClick={() => { setOpenOptions(null); onOpenProject(project.id, project.conversations[0]?.id); }}>
          <span className="project-folder" aria-hidden="true">▾</span><span>{project.name}</span>
        </button>
        <button type="button" className="project-new-chat" disabled={creating} title="New Chat" aria-label={`New chat in ${project.name}`}
          onClick={() => onCreate(project.id)}>＋</button>
      </div>
      <div className="project-conversations">
        {orderConversations(project.conversations, preferences).map(conversation => <ConversationRow
          key={conversation.id} conversation={conversation} selected={conversation.id === activeConversation}
          preference={preferences[conversation.id] ?? defaultPreference} open={conversation.id === openOptions}
          onToggle={() => setOpenOptions(current => current === conversation.id ? null : conversation.id)}
          onClose={() => setOpenOptions(current => current === conversation.id ? null : current)}
          onOpen={() => { setOpenOptions(null); onOpenConversation(conversation.id); }}
          onPreference={preference => setPreferences(current => {
            const next = { ...current };
            if (preference.pinned || preference.priority !== "normal") next[conversation.id] = preference;
            else delete next[conversation.id];
            return next;
          })} />)}
        {project.conversations.length === 0 && <button type="button" className="empty-project-chat"
          onClick={() => onCreate(project.id)}>Start first chat</button>}
      </div>
    </section>)}
    {!loading && visibleProjects.length === 0 && <div className="history-empty">{search ? "No matching projects or chats." : "No projects yet."}</div>}
  </nav>;
}
