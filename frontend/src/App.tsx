import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  clearAllRecords,
  createConversation,
  createProject,
  getConversation,
  getConversationExecution,
  pausePreviousExecution,
  stopConversationExecution,
  resumeConversationExecution,
  type ConversationExecution,
  getConversationEvents,
  getTeamStatus,
  getConversationUsage,
  getCollaborationSnapshot,
  type SessionUsage,
  type CollaborationSnapshot,
  listProjects,
  streamConversationMessage,
  executionLabel,
  type Activity,
  type ConversationDetail,
  type ProjectSummary,
  type TeamChatMessage,
  type TeamMember,
  type TeamUsage,
} from "./api";
import { applyConversationEvent } from "./conversationEvents";
import { displayConversationTitle } from "./conversationTitle";
import AgentContextPanel from "./AgentContextPanel";
import CollaborationPanel from "./CollaborationPanel";
import ConversationHistory, { conversationPreferencesKey } from "./ConversationHistory";
import DeliveryPanel from "./DeliveryPanel";
import { DeliveryPreview, useDeliveryFiles } from "./DeliveryFiles";
import AgentAvatar from "./AgentAvatar";
import MessageContent from "./MessageContent";
import { memberName, teamIdentities } from "./TeamIdentity";
import "./App.css";
import ExecutionPermissions from './ExecutionPermissions';
import ResourceSettings from './ResourceSettings';
import SessionUsagePanel from './SessionUsagePanel';
import WebsitePreview, { type WebsitePreviewHandle } from './WebsitePreview';
import AnnotationDrafts from './AnnotationDrafts';
import { annotationRequest, selectionIdentity, type VisualAnnotation, type VisualContext } from './visualFeedback';
import { requestsForTurn, reviewProgress } from './DeliveryProgress';

const OfficeScene = lazy(() => import("./OfficeScene"));

type VisibleMessage = TeamChatMessage & {
  read?: boolean;
  readBy?: string[];
  completedBy?: string[];
  time: string;
  createdAt?: number;
};
type VisibleActivity = Activity & { time: string; createdAt?: number };
type ConversationView = Omit<ConversationDetail, "messages" | "activities"> & {
  messages: VisibleMessage[];
  activities: VisibleActivity[];
};
type Panel = "chat" | "activity" | "collaboration" | "context";

const interfaceStyles = ["Blue-violet tech", "Clean & minimal", "Warm & natural", "Bright & playful", "Editorial"] as const;
const useScenarios = ["General website", "Portfolio", "Course showcase", "Event promotion", "Content hub", "Product showcase"] as const;
const developmentPreferences = ["Responsive layout", "Mobile first", "Accessibility first", "Subtle motion", "Dark mode support"] as const;

function composePrompt(content: string, style: string, scenario: string, preferences: string[]) {
  const constraints = [
    style && `- Interface Style: ${style}`,
    scenario && `- Use Case: ${scenario}`,
    preferences.length > 0 && `- Development Preferences: ${preferences.join(", ")}`,
  ].filter(Boolean);
  return constraints.length
    ? `${content}\n\nAdditional requirements to follow:\n${constraints.join("\n")}`
    : content;
}

const initialAgents: TeamMember[] = [
  { id: "leader", name: memberName("leader"), status: "idle", tools: [], skills: [] },
  { id: "product", name: memberName("product"), status: "idle", tools: [], skills: [] },
  { id: "backend", name: memberName("backend"), status: "idle", tools: [], skills: [] },
  { id: "designer", name: memberName("designer"), status: "idle", tools: [], skills: [] },
  { id: "frontend", name: memberName("frontend"), status: "idle", tools: [], skills: [] },
  { id: "testing", name: memberName("testing"), status: "idle", tools: [], skills: [] },
];

function clockTime(value = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

function toConversationView(detail: ConversationDetail): ConversationView {
  return {
    ...detail,
    messages: detail.messages.map((message) => ({
      id: message.id,
      sender: message.sender,
      content: message.content,
      mention: message.mention,
      mentions: message.mentions,
      read: !!message.mention && message.read_by.includes(message.mention),
      readBy: message.read_by,
      completedBy: message.completed_by,
      time: clockTime(new Date(message.created_at)),
      createdAt: Date.parse(message.created_at),
    })),
    activities: detail.activities.map((activity) => ({
      id: activity.id,
      agent: activity.agent,
      tool: activity.tool,
      description: activity.description,
      phase: activity.phase,
      time: clockTime(new Date(activity.created_at)),
      createdAt: Date.parse(activity.created_at),
    })),
  };
}

function App() {
  const [generation, setGeneration] = useState(0);
  return <Workspace key={generation} onRecordsCleared={() => setGeneration(value => value + 1)} />;
}

function Workspace({ onRecordsCleared }: { onRecordsCleared: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [teamMenu, setTeamMenu] = useState(false);
  const [resourceSettings, setResourceSettings] = useState(false);
  const teamMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!teamMenu) return;
    // Close on a press outside the menu. Not on blur: WebKit (the desktop app) does not
    // focus a clicked button, so blur would close the menu before its item's click.
    const outside = (event: PointerEvent) => { if (!teamMenuRef.current?.contains(event.target as Node)) setTeamMenu(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [teamMenu]);
  const [active, setActive] = useState<ConversationView | null>(null);
  const [agents, setAgents] = useState<TeamMember[]>(initialAgents);
  const [usage, setUsage] = useState<TeamUsage>({
    total_tokens: 0,
    agents: initialAgents.map((agent) => ({ id: agent.id, total_tokens: 0, context_tokens: 0, context_window: 131072, context_percent: 0 })),
  });
  const [sessionUsage, setSessionUsage] = useState<SessionUsage | null>(null);
  const [panel, setPanel] = useState<Panel>("chat");
  const [showCollaboration, setShowCollaboration] = useState(false);
  useEffect(() => { setShowCollaboration(false); }, [active?.id, panel]);
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [showWebsite, setShowWebsite] = useState(false);
  const [annotationDrafts, setAnnotationDrafts] = useState<Record<string, VisualAnnotation[]>>({});
  const [currentSelection, setCurrentSelection] = useState<VisualContext | null>(null);
  const currentSelectionRef = useRef(currentSelection); currentSelectionRef.current = currentSelection;
  const [preparingMessage, setPreparingMessage] = useState(false);
  const preparing = useRef(false);
  const website = useRef<WebsitePreviewHandle>(null);
  const activeId = useRef(active?.id); activeId.current = active?.id;
  const annotations = active ? annotationDrafts[active.id] || [] : [];
  useEffect(() => { setShowWebsite(false); setCurrentSelection(null); }, [active?.id]);
  const [interfaceStyle, setInterfaceStyle] = useState("");
  const [useScenario, setUseScenario] = useState("");
  const [preferences, setPreferences] = useState<string[]>([]);
  const [streamingConversation, setStreamingConversation] = useState<string | null>(null);
  const streaming = streamingConversation !== null;
  const [execution, setExecution] = useState<Record<string, ConversationExecution>>({});
  const [executionAction, setExecutionAction] = useState<string | null>(null);
  const executionVersion = useRef(0);
  const activeExecution = active ? execution[active.id] : undefined;
  const canStop = !!active && (streamingConversation === active.id || !!activeExecution?.running || !!activeExecution?.stopping);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projectDialog, setProjectDialog] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [projectError, setProjectError] = useState("");
  const [projectSaving, setProjectSaving] = useState(false);
  const [resetDialog, setResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const controller = useRef<{ conversation: string; abort: AbortController } | null>(null);
  const chatFeed = useRef<HTMLDivElement | null>(null);
  const followChat = useRef(true);
  const chatPosition = useRef(0);
  useLayoutEffect(() => {
    followChat.current = true;
    chatPosition.current = 0;
  }, [active?.id]);

  const activeProject = projects.find((project) => project.id === (active?.project_id || activeProjectId));
  const [openFile, setOpenFile] = useState<{project: string; path: string} | null>(null);
  const [collaborationSnapshot, setCollaborationSnapshot] = useState<CollaborationSnapshot>({ request: [] });
  const deliveryFiles = useDeliveryFiles(activeProject?.id);
  const deliveredEntries = deliveryFiles.entries.filter((entry) => entry.kind === "file");
  const latestUserMessage = [...(active?.messages || [])].reverse().find(message => message.sender === "user");
  const latestUserMessageAt = latestUserMessage?.createdAt || 0;
  const currentDeliveryEntries = deliveredEntries.filter((entry) => latestUserMessageAt > 0 && entry.modified / 1_000_000 >= latestUserMessageAt);
  const previewEntry = [...currentDeliveryEntries].sort((left, right) => {
    const priority = (path: string) => /(^|\/)index\.html?$/i.test(path) ? 0 : /\.html?$/i.test(path) ? 1 : /(^|\/)readme\.(md|markdown)$/i.test(path) ? 2 : /\.(png|jpe?g|webp|gif|svg|pdf)$/i.test(path) ? 3 : 4;
    return priority(left.path) - priority(right.path) || left.path.localeCompare(right.path);
  })[0];
  useEffect(() => {
    const project = activeProject?.id;
    setCollaborationSnapshot({ request: [] });
    if (!project) return;
    const controller = new AbortController();
    const refresh = () => void getCollaborationSnapshot(project, controller.signal)
      .then(snapshot => { if (!controller.signal.aborted) setCollaborationSnapshot(snapshot); })
      .catch(() => { /* Delivery progress retains its last verified state during a transient reconnect. */ });
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [activeProject?.id]);
  useEffect(() => { setOpenFile(null); }, [activeProject?.id]);
  function showFile(path: string) {
    if (activeProject) {
      setOpenFile({project: activeProject.id, path});
      if (window.innerWidth <= 880) document.querySelector('.office')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  const nameOf = (id: string) => memberName(id);

  async function openConversation(id: string) {
    const detail = await getConversation(id);
    setActive(toConversationView(detail));
    setActiveProjectId(detail.project_id);
    setPanel("chat");
    setInput("");
    setError("");
  }

  async function refreshProjects(preferredConversationId?: string) {
    const items = await listProjects();
    setProjects(items);
    if (preferredConversationId) {
      await openConversation(preferredConversationId);
      return;
    }
    if (active && items.some((project) => project.conversations.some((conversation) => conversation.id === active.id))) return;
    const firstProject = items[0];
    setActiveProjectId(firstProject?.id || null);
    if (firstProject?.conversations[0]) await openConversation(firstProject.conversations[0].id);
    else setActive(null);
  }

  useEffect(() => {
    const abort = new AbortController();
    pausePreviousExecution().then(() => Promise.all([
      getTeamStatus(abort.signal).then((team) => {
        setAgents(team.agents);
        if (team.usage) setUsage(team.usage);
      }),
      listProjects(abort.signal).then(async (items) => {
        setProjects(items);
        const first = items[0];
        setActiveProjectId(first?.id || null);
        if (first?.conversations[0]) {
          const detail = await getConversation(first.conversations[0].id, abort.signal);
          setActive(toConversationView(detail));
        }
      }),
    ])).catch((cause) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load projects.");
    }).finally(() => setLoading(false));
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    const timer = setInterval(() => {
      void getTeamStatus(abort.signal).then(team => { if (!abort.signal.aborted) { setAgents(team.agents); setUsage(team.usage); } }).catch(() => {});
      if (active?.id) void getConversationUsage(active.id, abort.signal).then(data => { if (!abort.signal.aborted && data.conversation_id === active.id) setSessionUsage(data); }).catch(() => {});
      if (active?.id && !streaming) {
        void getConversation(active.id, abort.signal).then(detail => {
          if (!abort.signal.aborted) setActive(current => current?.id === detail.id ? toConversationView(detail) : current);
        }).catch(() => {});
      }
    }, 3000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [active?.id, streaming]);

  useEffect(() => {
    if (!active?.id) return;
    const id = active.id;
    const abort = new AbortController();
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 1000;
      try {
        const page = await getConversationEvents(id, cursor, abort.signal);
        if (abort.signal.aborted) return;
        setActive(current => current?.id === id
          ? page.events.reduce((view, event) => applyConversationEvent(view, event), current) : current);
        cursor = page.cursor;
        if (page.has_more) delay = 0;
      } catch { /* Retry from the same cursor; no background events are dropped. */ }
      finally { if (!abort.signal.aborted) timer = setTimeout(poll, delay); }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [active?.id]);

  useEffect(() => {
    if (!active?.id) return;
    const id = active.id;
    const abort = new AbortController();
    async function poll() {
      const version = executionVersion.current;
      try {
        const state = await getConversationExecution(id, abort.signal);
        if (!abort.signal.aborted && version === executionVersion.current) setExecution(current => ({ ...current, [id]: state }));
      } catch { /* Retain the last known execution state on a transient disconnect. */ }
    }
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [active?.id]);

  async function controlExecution(action: 'stop' | 'resume') {
    if (!active || executionAction) return;
    const id = active.id;
    setExecutionAction(id); setError(''); executionVersion.current++;
    try {
      const state = await (action === 'stop' ? stopConversationExecution(id) : resumeConversationExecution(id));
      executionVersion.current++;
      setExecution(current => ({ ...current, [id]: state }));
      if (action === 'stop' && controller.current?.conversation === id) controller.current.abort.abort();
      const detail = await getConversation(id);
      setActive(current => current?.id === id ? toConversationView(detail) : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update task status. Try again.');
    } finally { setExecutionAction(null); }
  }

  useEffect(() => {
    const pauseOnExit = () => { void pausePreviousExecution(true).catch(() => {}); };
    window.addEventListener('pagehide', pauseOnExit);
    return () => window.removeEventListener('pagehide', pauseOnExit);
  }, []);

  useEffect(() => () => controller.current?.abort.abort(), []);
  useLayoutEffect(() => {
    const feed = chatFeed.current;
    if (panel !== "chat" || !feed) return;
    feed.scrollTop = followChat.current ? feed.scrollHeight : chatPosition.current;
  }, [active?.id, active?.messages, panel, showCollaboration]);

  async function startConversation(projectId = activeProjectId) {
    if (streaming) return;
    if (!projectId) {
      setProjectDialog(true);
      return;
    }
    try {
      setError("");
      const created = await createConversation(projectId);
      await refreshProjects(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the chat.");
    }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = workspaceDraft.trim();
    if (!path || projectSaving) return;
    setProjectSaving(true);
    setProjectError("");
    try {
      const project = await createProject(projectName, path);
      const conversation = await createConversation(project.id);
      setProjectDialog(false);
      setProjectName("");
      setWorkspaceDraft("");
      await refreshProjects(conversation.id);
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : "Could not create the project.");
    } finally {
      setProjectSaving(false);
    }
  }

  async function chooseWorkspace() {
    if (!isTauri()) return;
    setProjectError("");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        canCreateDirectories: true,
        title: "Choose a project folder",
        defaultPath: workspaceDraft || undefined,
      });
      if (typeof selected === "string") setWorkspaceDraft(selected);
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : "Could not open the folder picker.");
    }
  }

  async function resetRecords() {
    if (resetting) return;
    setResetting(true);
    setResetError("");
    controller.current?.abort.abort();
    try {
      await clearAllRecords();
      try { window.localStorage.removeItem(conversationPreferencesKey); }
      catch { /* Storage may be unavailable. */ }
      // Remount all project state and subscriptions; old async responses belong
      // to the discarded workspace and cannot restore deleted records.
      onRecordsCleared();
    } catch (cause) {
      setResetError(cause instanceof Error ? cause.message : "Could not clear records. Try again.");
      setResetting(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!input.trim() && !annotations.length) || streaming || executionAction || !active || preparing.current) return;
    const conversation = active.id, draft = input;
    const sentIds = new Set(annotations.map(item => item.id));
    preparing.current = true; setPreparingMessage(true); setError('');
    try {
      if (annotations.some(item => !item.comment.trim())) throw new Error('Fill in or remove empty annotations before sending.');
      const selection = currentSelection ? await website.current?.captureSelection() : null;
      if (currentSelection && (!selection || !selection.elements.length && !selection.region)) throw new Error('This selection is no longer available. Select the area again or remove it.');
      if (currentSelection && selectionIdentity(currentSelection) !== selectionIdentity(selection)) throw new Error('The selection changed. Confirm the area and send again.');
      if (activeId.current !== conversation) return;
      const content = annotationRequest(composePrompt(draft.trim(), interfaceStyle, useScenario, preferences), annotations, selection);
      if (content.length > 19000) throw new Error('The message is too long. Shorten it or send it in batches. Your drafts are saved.');
      const sent = await sendContent(content);
      if (!sent) return;
      setAnnotationDrafts(current => ({ ...current, [conversation]: (current[conversation] || []).filter(item => !sentIds.has(item.id)) }));
      if (activeId.current === conversation) {
        setInput(value => value === draft ? '' : value);
        setInterfaceStyle(''); setUseScenario(''); setPreferences([]);
        if (selection && selectionIdentity(currentSelectionRef.current) === selectionIdentity(selection)) {
          website.current?.clearSelection(); setCurrentSelection(null);
        }
      }
    } catch (cause) { if (activeId.current === conversation) setError(cause instanceof Error ? cause.message : 'Could not send. Your drafts are saved.'); }
    finally { preparing.current = false; setPreparingMessage(false); }
  }

  async function sendContent(content: string) {
    if (!content || streaming || executionAction || !active) throw new Error('Could not send right now. Try again shortly.');
    const conversationId = active.id;
    const updateConversation = (update: (item: ConversationView) => ConversationView) =>
      setActive(current => current?.id === conversationId ? update(current) : current);
    const clientMessageId = crypto.randomUUID();
    let replyId = "";
    updateConversation((item) => ({
      ...item,
      messages: [...item.messages, { id: clientMessageId, sender: "user", content, time: clockTime(), createdAt: Date.now() }],
    }));
    setError("");
    executionVersion.current++;
    setExecution(current => ({ ...current, [conversationId]: { running: true, stopping: false, paused: current[conversationId]?.paused || false, pending_tasks: current[conversationId]?.pending_tasks || 0, active_goals: current[conversationId]?.active_goals || 0 } }));
    setStreamingConversation(conversationId);
    setPanel("chat");
    const abort = new AbortController();
    controller.current = { conversation: conversationId, abort };
    try {
      await streamConversationMessage(conversationId, content, clientMessageId, {
        onDelta: (delta, messageId) => {
          replyId = messageId || replyId || `reply-${clientMessageId}`;
          updateConversation((item) => ({
            ...item,
            messages: item.messages.some((message) => message.id === replyId)
              ? item.messages.map((message) => message.id === replyId ? { ...message, content: message.content + delta } : message)
              : [...item.messages, { id: replyId, sender: "leader", content: delta, time: clockTime(), createdAt: Date.now() }],
          }));
        },
        onStatus: ({ id, status }) => setAgents((current) => current.map((agent) => agent.id === id ? { ...agent, status } : agent)),
        onMessage: (message) => updateConversation(item => applyConversationEvent(item, {
          sequence: 0, type: 'chat_message', payload: message, created_at: new Date().toISOString(),
        })),
        onRead: ({ message_id, reader }) => updateConversation((item) => ({
          ...item,
          messages: item.messages.map((message) => message.id === message_id
            ? { ...message, read: message.mention === reader || message.read, readBy: [...new Set([...(message.readBy || []), reader])] }
            : message),
        })),
        onReaction: ({ message_id, worker }) => updateConversation((item) => ({
          ...item,
          messages: item.messages.map((message) => message.id === message_id
            ? { ...message, completedBy: [...new Set([...(message.completedBy || []), worker])] }
            : message),
        })),
        onActivity: (activity) => updateConversation(item => applyConversationEvent(item, {
          sequence: 0, type: 'activity', payload: activity, created_at: new Date().toISOString(),
        })),
        onUsage: setUsage,
        onTitle: (title) => {
          setActive((item) => item?.id === conversationId ? { ...item, title } : item);
          setProjects((items) => items.map((project) => ({
            ...project,
            conversations: project.conversations.map((conversation) =>
              conversation.id === conversationId ? { ...conversation, title } : conversation),
          })));
        },
      }, abort.signal);
      return !abort.signal.aborted;
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Request failed.");
      if (!abort.signal.aborted) throw cause;
    } finally {
      controller.current = null;
      setStreamingConversation(null);
      try {
        if (abort.signal.aborted) return;
        const [detail, projectItems, team] = await Promise.all([
          getConversation(conversationId), listProjects(), getTeamStatus(),
        ]);
        if (abort.signal.aborted) return;
        setActive(current => current?.id === conversationId ? toConversationView(detail) : current);
        setProjects(projectItems);
        setAgents(team.agents);
        if (team.usage) setUsage(team.usage);
      } catch { /* Keep the streamed view when the refresh is temporarily unavailable. */ }
    }
  }

  const hasUserRequest = latestUserMessageAt > 0;
  const teamWorking = canStop;
  const testingRunning = active?.activities.some((activity) => activity.agent === "testing" && activity.phase === "running" && (activity.createdAt || 0) >= latestUserMessageAt) || false;
  const testingCompleted = active?.activities.some((activity) => activity.agent === "testing" && activity.phase === "completed" && (activity.createdAt || 0) >= latestUserMessageAt) || false;
  const turnRequests = requestsForTurn(collaborationSnapshot.request || [], active?.id, latestUserMessage?.id, latestUserMessageAt);
  const review = reviewProgress(turnRequests, testingRunning, testingCompleted);
  const deliveryReady = currentDeliveryEntries.length > 0;
  const finalCheckReady = deliveryReady && review.accepted && !teamWorking;
  const progressStep = finalCheckReady ? 3 : deliveryReady || review.checking || review.accepted ? 2 : hasUserRequest ? 1 : 0;
  const progressLabels = ["Plan", "Build", "Review", "Ready"];

  return <main className="workspace">
    <aside className="sidebar" aria-label="Projects and chat history">
      <div className="sidebar-head">
        <div className="brand"><span className="brand-mark">W</span><strong>Wdrunge</strong></div>
        <button className="new-project" onClick={() => { setProjectError(""); setProjectDialog(true); }} disabled={streaming}><span>＋</span> New Project</button>
        <label className="history-search"><span>⌕</span><input aria-label="Search projects and chats" placeholder="Search projects and chats" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      </div>
      <ConversationHistory projects={projects} search={search} loading={loading}
        activeProject={activeProject?.id} activeConversation={active?.id} creating={streaming}
        onOpenProject={(project, conversation) => {
          setActiveProjectId(project);
          if (conversation) void openConversation(conversation);
          else setActive(null);
        }} onOpenConversation={id => void openConversation(id)} onCreate={id => void startConversation(id)} />
      <ExecutionPermissions />
      <div className="debug-tools"><small>Debug tools</small><button onClick={() => { setResetError(""); setResetDialog(true); }} disabled={loading || projectSaving}>Clear All Records</button></div>
      <div className="team-menu-wrap" ref={teamMenuRef} onKeyDown={(event) => { if (event.key === "Escape") setTeamMenu(false); }}>
        {teamMenu && <div className="team-menu" role="menu" aria-label="Agent Team">
          <button role="menuitem" autoFocus onClick={() => { setTeamMenu(false); setResourceSettings(true); }}>Services & Databases<small>Manage addresses and accounts for databases, caches, and other services.</small></button>
        </div>}
        <button className="sidebar-foot team-menu-trigger" aria-haspopup="menu" aria-expanded={teamMenu} onClick={() => setTeamMenu((open) => !open)}><span className="foot-mark">W</span><span>Agent Team<small>{agents.length} members ready</small></span></button>
      </div>
    </aside>

    <section className="office" aria-label="Agent Office">
      <div className="creation-progress" aria-label="Build progress" role="status">
        <span className="creation-progress-label">Build progress</span>
        {progressLabels.map((label, index) => <span className={`creation-progress-step ${index < progressStep ? "complete" : index === progressStep ? "current" : ""}`} key={label}><i aria-hidden="true" />{label}</span>)}
      </div>
      {showWebsite && active ? <WebsitePreview key={active.id} ref={website} annotations={annotations} onSelection={setCurrentSelection}
        busy={streaming || !!executionAction || preparingMessage} onRequest={async content => { await sendContent(content); }}
        onAnnotation={item => {
          const conversation = active.id;
          setAnnotationDrafts(current => ({ ...current, [conversation]: [...(current[conversation] || []), item] }));
          setPanel('chat'); setShowCollaboration(false);
        }} onClose={() => { setShowWebsite(false); setCurrentSelection(null); }} /> : <><div className="office-content" inert={!!openFile}>
        <Suspense fallback={<div className="office-loading" role="status"><span aria-hidden="true" /><strong>Loading the office…</strong><small>3D assets may take a moment to load.</small></div>}>
          <OfficeScene agents={agents} />
        </Suspense>
      </div>{active && <button className="website-preview-toggle" onClick={() => { setOpenFile(null); setShowWebsite(true); }}>Site Preview ↗</button>}</>}
      {openFile && activeProject?.id === openFile.project && <DeliveryPreview key={`${openFile.project}:${openFile.path}`} project={openFile.project} path={openFile.path} revision={deliveryFiles.revision} status={deliveryFiles.status} onClose={() => setOpenFile(null)} onOpen={showFile} />}
    </section>

    <aside className="right-rail" aria-label="Team chat and activity">
      <div className="rail-tabs" role="tablist" aria-label="Workspace panels">
        <button role="tab" aria-selected={panel === "chat"} className={panel === "chat" ? "active" : ""} onClick={() => setPanel("chat")}>Team Chat</button>
        <button role="tab" aria-selected={panel === "activity"} className={panel === "activity" ? "active" : ""} onClick={() => setPanel("activity")}>Activity <span>{active?.activities.length || 0}</span></button>
        <button role="tab" aria-selected={panel === "collaboration"} className={panel === "collaboration" ? "active" : ""} onClick={() => setPanel("collaboration")}>Deliverables</button>
        <button role="tab" aria-selected={panel === "context"} className={panel === "context" ? "active" : ""} onClick={() => setPanel("context")}>Agent Context</button>
      </div>
      {panel === "collaboration" && activeProject ? <DeliveryPanel key={activeProject.id} files={deliveryFiles} selected={openFile?.path || null} onOpen={showFile} /> : !active ? <section className="chat-panel empty-conversation"><div className="chat-welcome"><span className="welcome-icon">W</span><strong>{activeProject ? activeProject.name : "Welcome to Wdrunge"}</strong><p>{activeProject ? "Start a chat in this project." : "Create a project to give your team a shared workspace."}</p><button onClick={() => activeProject ? void startConversation(activeProject.id) : setProjectDialog(true)}>{activeProject ? "New Chat" : "New Project"}</button></div></section> : panel === "context" ? <AgentContextPanel key={active.id} conversation={active.id} /> : panel === "chat" ? <section className="chat-panel" role="tabpanel" aria-label="Team Chat">
        <header className="panel-heading"><div><strong>{active.project_name} · {displayConversationTitle(active.title)}</strong><span>{Object.values(teamIdentities).map((member) => member.name).join(" · ")}</span></div><div className="chat-heading-actions"><button aria-expanded={showCollaboration} onClick={() => setShowCollaboration(value => !value)}>{showCollaboration ? "Back to Chat" : "Tasks"}</button><span className="member-count">6 members</span></div></header>
        {showCollaboration ? <CollaborationPanel key={active.id} project={active.project_id} conversation={active.id} onOpen={showFile} /> : <>
        <div className="workspace-banner"><span title={active.workspace_path}>Workspace · {active.workspace_path}</span></div>
        <div className="chat-feed" ref={chatFeed} onScroll={event => {
          const feed = event.currentTarget;
          chatPosition.current = feed.scrollTop;
          followChat.current = feed.scrollHeight - feed.clientHeight - feed.scrollTop <= 32;
        }}>
          {active.messages.length === 0 && <div className="chat-welcome"><span className="welcome-icon">W</span><strong>Start a chat</strong><p>Message {teamIdentities.leader.name} to get started. Chats are saved to the project.</p></div>}
          {active.messages.map((message) => <article className={`chat-message ${message.sender === "user" ? "mine" : ""}`} key={message.id}><AgentAvatar agent={message.sender} /><div className="message-body"><div className="message-meta"><strong>{nameOf(message.sender)}</strong><time>{message.time}</time></div><div className="bubble"><MessageContent message={message} /></div>{!!message.completedBy?.length && <div className="message-reactions" aria-label="Task completion">{message.completedBy.map((worker) => <span className="done-reaction" key={worker} title={`${nameOf(worker)} completed`}><span aria-hidden="true">✓</span> Done · {nameOf(worker)}</span>)}</div>}</div></article>)}
          {canStop && <div className="processing" role="status"><i /><i /><i /><span>{executionLabel(activeExecution, streamingConversation === active.id)}</span></div>}
        </div>
        {hasUserRequest && <details className="delivery-ready-card" aria-label="Page status">
          <summary><div><span className="delivery-ready-spark" aria-hidden="true">✦</span><strong>{finalCheckReady ? "Ready to preview" : deliveryReady ? "Review in progress" : "Building page"}</strong></div><span className="delivery-ready-meta"><small>{deliveryFiles.status === "live" ? "Live sync" : "Connecting to files…"}</small><i aria-hidden="true">⌄</i></span></summary>
          <div className="delivery-ready-body">
            <div className="delivery-ready-checks">
              {[
                { label: "Page built", done: deliveryReady, working: teamWorking && !deliveryReady },
                { label: "Interaction check", done: review.accepted, working: review.checking },
                { label: "Functional check", done: finalCheckReady, working: review.checking || (deliveryReady && teamWorking) },
              ].map((item) => <span className={item.done ? "done" : item.working ? "working" : "waiting"} key={item.label}><i aria-hidden="true">{item.done ? "✓" : item.working ? "•" : "○"}</i>{item.label}<small>{item.done ? "Complete" : item.working ? "In progress" : "Pending"}</small></span>)}
            </div>
            <button type="button" disabled={!previewEntry} onClick={() => previewEntry && showFile(previewEntry.path)} title={previewEntry ? `Preview ${previewEntry.path}` : "Preview is available after files are delivered"}>Open Preview <span aria-hidden="true">↗</span></button>
          </div>
        </details>}
        <div className="composer-area">
          {activeExecution?.paused && <div className="composer-paused">
            <span role="status"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5v7m5-7v7" /></svg>Previous tasks paused</span>
            <button className="composer-resume" type="button" disabled={executionAction !== null} onClick={() => void controlExecution('resume')} title="Resume unfinished tasks in this chat">
              {executionAction === active.id ? <span className="composer-spinner" aria-hidden="true" /> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 6 4-6 4Z" /></svg>}
              Resume
            </button>
          </div>}
          {error && <p className="error" role="alert">{error}</p>}
          <form className="composer" onSubmit={send}>
            <AnnotationDrafts items={annotations} current={currentSelection} disabled={streaming || preparingMessage}
              onChange={items => setAnnotationDrafts(current => ({ ...current, [active.id]: items }))}
              onClearSelection={() => { website.current?.clearSelection(); setCurrentSelection(null); }} />
            <textarea aria-label="Message the team…" placeholder={annotations.length ? 'Add instructions or send your annotations…' : currentSelection ? 'Describe what to change in this area…' : 'Message the team…'} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={2} />
            <div className="prompt-controls" aria-label="Page requirements">
              <details className="prompt-control">
                <summary className={interfaceStyle ? "selected" : ""}>Interface Style{interfaceStyle && <span>{interfaceStyle}</span>}</summary>
                <div className="prompt-popover"><strong>Choose a style</strong><small>Included in your instructions to the team.</small>{interfaceStyles.map((style) => <button type="button" className={interfaceStyle === style ? "active" : ""} onClick={(event) => { setInterfaceStyle(interfaceStyle === style ? "" : style); event.currentTarget.closest("details")?.removeAttribute("open"); }} key={style}>{style}{interfaceStyle === style && <span>✓</span>}</button>)}</div>
              </details>
              <details className="prompt-control">
                <summary className={useScenario ? "selected" : ""}>Use Case{useScenario && <span>{useScenario}</span>}</summary>
                <div className="prompt-popover"><strong>Choose a use case</strong><small>Helps the team organize the page.</small>{useScenarios.map((scenario) => <button type="button" className={useScenario === scenario ? "active" : ""} onClick={(event) => { setUseScenario(useScenario === scenario ? "" : scenario); event.currentTarget.closest("details")?.removeAttribute("open"); }} key={scenario}>{scenario}{useScenario === scenario && <span>✓</span>}</button>)}</div>
              </details>
              <details className="prompt-control">
                <summary className={preferences.length ? "selected" : ""}>More Options{preferences.length > 0 && <span>{preferences.length} selected</span>}</summary>
                <div className="prompt-popover prompt-popover-wide"><strong>Development preferences</strong><small>Select any that apply.</small>{developmentPreferences.map((preference) => <button type="button" className={preferences.includes(preference) ? "active" : ""} onClick={() => setPreferences((current) => current.includes(preference) ? current.filter((item) => item !== preference) : [...current, preference])} key={preference}>{preference}{preferences.includes(preference) && <span>✓</span>}</button>)}</div>
              </details>
            </div>
            <div className="composer-bottom">
              <span>Enter to send · Shift+Enter for a new line</span>
              {canStop ? <button className="composer-submit" type="button" disabled={executionAction !== null} onClick={() => void controlExecution('stop')} aria-label="Stop" title="Stop generation, tasks, and running processes for this chat">
                {executionAction === active.id ? <span className="composer-spinner" aria-hidden="true" /> : <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" /></svg>}
              </button> : <button className="composer-submit" type="submit" disabled={(!input.trim() && !annotations.length) || streaming || preparingMessage || executionAction !== null} aria-label="Send" title="Send message">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5m-4 4 4-4 4 4" /></svg>
              </button>}
            </div>
          </form>
        </div>
        </>}
      </section> : <section className="log-panel" role="tabpanel" aria-label="Activity">
        <div className="usage-dashboard"><SessionUsagePanel usage={active && sessionUsage?.conversation_id === active.id ? sessionUsage : null} nameOf={nameOf} allTokens={usage.total_tokens} /><div className="context-usage"><div className="context-heading" title="Updated every 3 seconds from model usage. For roles with multiple instances, the highest context usage is shown.">Context usage</div>{agents.map((agent) => { const item = usage.agents.find((member) => member.id === agent.id); const percent = item?.context_percent ?? 0; return <div className="context-row" key={agent.id} title={`${item?.context_tokens ?? 0} / ${item?.context_window ?? 131072} tokens`}><span title={nameOf(agent.id)}>{memberName(agent.id, false)}</span><div className="context-track"><i style={{ width: `${Math.min(percent, 100)}%` }} /></div><strong>{percent.toFixed(1)}%</strong></div>; })}</div></div>
        <header className="panel-heading"><div><strong>Tool Activity</strong><span>Agent tool calls in chronological order</span></div><span className="member-count">{active.activities.length} calls</span></header>
        <div className="activity-feed">{active.activities.length === 0 ? <div className="activity-empty">No tool calls yet.</div> : <ol className="timeline">{[...active.activities].reverse().map((item) => <li key={item.id}><span className="timeline-avatar"><AgentAvatar agent={item.agent} /><span className={`timeline-dot ${item.phase}`} /></span><div className="timeline-top"><strong>{nameOf(item.agent)}</strong><time>{item.time}</time></div><p>{item.description}</p><div className="timeline-foot"><code>{item.tool}</code><span className={`activity-phase ${item.phase}`}>{item.phase === "running" ? "In progress" : item.phase === "completed" ? "Complete" : "Failed"}</span></div></li>)}</ol>}</div>
      </section>}
    </aside>

    {resourceSettings && <ResourceSettings projects={projects} activeProject={activeProject} onClose={() => setResourceSettings(false)} />}
    {resetDialog && <div className="workspace-dialog-backdrop" role="presentation"><section className="workspace-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description"><h2 id="reset-title">Clear all records?</h2><div id="reset-description"><p>This stops running tasks and clears all projects, chats, activity logs, collaboration requests, document versions and subscriptions, messages, model memory, and token usage.</p><p>Workspace files are kept. Cleared records cannot be recovered.</p></div>{resetError && <p className="workspace-dialog-error" role="alert">{resetError}</p>}<div className="workspace-dialog-actions"><button autoFocus onClick={() => setResetDialog(false)} disabled={resetting}>Cancel</button><button className="reset-confirm" onClick={() => void resetRecords()} disabled={resetting}>{resetting ? "Stopping tasks and clearing…" : "Clear All Records"}</button></div></section></div>}
    {projectDialog && <div className="workspace-dialog-backdrop" role="presentation"><form className="workspace-dialog" onSubmit={saveProject} role="dialog" aria-modal="true" aria-label="New Project"><h2>New Project</h2><p>Each project uses a local workspace and can contain multiple chats.</p><label htmlFor="project-name">Project name</label><input id="project-name" autoFocus placeholder="Uses the folder name by default" value={projectName} onChange={(event) => setProjectName(event.target.value)} /><label htmlFor="workspace-path">Workspace folder</label><div className="workspace-picker"><input id="workspace-path" placeholder="Choose or enter a project folder" value={workspaceDraft} onChange={(event) => setWorkspaceDraft(event.target.value)} /><button type="button" onClick={() => void chooseWorkspace()} disabled={!isTauri() || projectSaving}>{isTauri() ? "Browse…" : "Desktop only"}</button></div>{!isTauri() && <small className="workspace-browser-hint">Enter the absolute path in the browser. Use the folder picker in the desktop app.</small>}{projectError && <p className="workspace-dialog-error" role="alert">{projectError}</p>}<div className="workspace-dialog-actions"><button type="button" onClick={() => setProjectDialog(false)} disabled={projectSaving}>Cancel</button><button type="submit" disabled={!workspaceDraft.trim() || projectSaving}>{projectSaving ? "Creating…" : "Create Project"}</button></div></form></div>}
  </main>;
}

export default App;
