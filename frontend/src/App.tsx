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
  type Activity,
  type ConversationDetail,
  type ProjectSummary,
  type TeamChatMessage,
  type TeamMember,
  type TeamUsage,
} from "./api";
import { applyConversationEvent } from "./conversationEvents";
import AgentContextPanel from "./AgentContextPanel";
import CollaborationPanel from "./CollaborationPanel";
import DeliveryPanel from "./DeliveryPanel";
import { DeliveryPreview, useDeliveryFiles } from "./DeliveryFiles";
import AgentAvatar from "./AgentAvatar";
import MessageContent from "./MessageContent";
import { memberName, teamIdentities } from "./TeamIdentity";
import "./App.css";
import ExecutionPermissions from './ExecutionPermissions';
import ResourceSettings from './ResourceSettings';
import SessionUsagePanel from './SessionUsagePanel';
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

const interfaceStyles = ["蓝紫科技", "清爽简约", "温暖自然", "活泼明亮", "杂志排版"] as const;
const useScenarios = ["通用网站", "个人作品", "课程展示", "活动宣传", "内容主页", "产品介绍"] as const;
const developmentPreferences = ["响应式布局", "移动端优先", "无障碍优先", "动效克制", "支持深色模式"] as const;

function composePrompt(content: string, style: string, scenario: string, preferences: string[]) {
  const constraints = [
    style && `- 界面风格：${style}`,
    scenario && `- 使用场景：${scenario}`,
    preferences.length > 0 && `- 开发偏好：${preferences.join("、")}`,
  ].filter(Boolean);
  return constraints.length
    ? `${content}\n\n补充要求（请在实现时遵循）：\n${constraints.join("\n")}`
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
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
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
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "加载项目失败");
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
      setError(cause instanceof Error ? cause.message : '无法更新任务状态，请重试');
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
      setError(cause instanceof Error ? cause.message : "新建对话失败");
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
      setProjectError(cause instanceof Error ? cause.message : "创建项目失败");
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
        title: "选择项目文件夹",
        defaultPath: workspaceDraft || undefined,
      });
      if (typeof selected === "string") setWorkspaceDraft(selected);
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : "无法打开文件夹选择器");
    }
  }

  async function resetRecords() {
    if (resetting) return;
    setResetting(true);
    setResetError("");
    controller.current?.abort.abort();
    try {
      await clearAllRecords();
      // Remount all project state and subscriptions; old async responses belong
      // to the discarded workspace and cannot restore deleted records.
      onRecordsCleared();
    } catch (cause) {
      setResetError(cause instanceof Error ? cause.message : "清除失败，请重试");
      setResetting(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = input.trim();
    if (!draft || streaming || executionAction || !active) return;
    const content = composePrompt(draft, interfaceStyle, useScenario, preferences);
    const conversationId = active.id;
    const updateConversation = (update: (item: ConversationView) => ConversationView) =>
      setActive(current => current?.id === conversationId ? update(current) : current);
    const clientMessageId = crypto.randomUUID();
    let replyId = "";
    updateConversation((item) => ({
      ...item,
      messages: [...item.messages, { id: clientMessageId, sender: "user", content, time: clockTime(), createdAt: Date.now() }],
    }));
    setInput("");
    setInterfaceStyle("");
    setUseScenario("");
    setPreferences([]);
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
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "请求失败");
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

  const visibleProjects = projects.map((project) => ({
    ...project,
    conversations: project.name.toLowerCase().includes(search.toLowerCase())
      ? project.conversations
      : project.conversations.filter((conversation) => conversation.title.toLowerCase().includes(search.toLowerCase())),
  })).filter((project) => !search || project.name.toLowerCase().includes(search.toLowerCase()) || project.conversations.length > 0);

  const hasUserRequest = latestUserMessageAt > 0;
  const teamWorking = canStop;
  const testingRunning = active?.activities.some((activity) => activity.agent === "testing" && activity.phase === "running" && (activity.createdAt || 0) >= latestUserMessageAt) || false;
  const testingCompleted = active?.activities.some((activity) => activity.agent === "testing" && activity.phase === "completed" && (activity.createdAt || 0) >= latestUserMessageAt) || false;
  const turnRequests = requestsForTurn(collaborationSnapshot.request || [], active?.id, latestUserMessage?.id, latestUserMessageAt);
  const review = reviewProgress(turnRequests, testingRunning, testingCompleted);
  const deliveryReady = currentDeliveryEntries.length > 0;
  const finalCheckReady = deliveryReady && review.accepted && !teamWorking;
  const progressStep = finalCheckReady ? 3 : deliveryReady || review.checking || review.accepted ? 2 : hasUserRequest ? 1 : 0;
  const progressLabels = ["理解需求", "正在制作", "检查页面", "可以预览"];

  return <main className="workspace">
    <aside className="sidebar" aria-label="项目与聊天历史">
      <div className="sidebar-head">
        <div className="brand"><span className="brand-mark">W</span><strong>Wdrunge</strong></div>
        <button className="new-project" onClick={() => { setProjectError(""); setProjectDialog(true); }} disabled={streaming}><span>＋</span> 新建项目</button>
        <label className="history-search"><span>⌕</span><input aria-label="搜索项目和对话" placeholder="搜索项目或对话" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      </div>
      <nav className="project-list" aria-label="项目列表">
        {visibleProjects.map((project) => <section className={`project-group ${project.id === activeProject?.id ? "selected" : ""}`} key={project.id}>
          <div className="project-row">
            <button className="project-name" onClick={() => { setActiveProjectId(project.id); if (project.conversations[0]) void openConversation(project.conversations[0].id); else setActive(null); }} title={project.workspace_path}><span className="project-folder">▾</span><span>{project.name}</span></button>
            <button className="project-new-chat" onClick={() => void startConversation(project.id)} disabled={streaming} title="新建对话">＋</button>
          </div>
          <div className="project-conversations">
            {project.conversations.map((conversation) => <button key={conversation.id} className={`history-item ${conversation.id === active?.id ? "selected" : ""}`} onClick={() => void openConversation(conversation.id)} title={conversation.title}><span className="history-icon">◻</span><span>{conversation.title}</span></button>)}
            {project.conversations.length === 0 && <button className="empty-project-chat" onClick={() => void startConversation(project.id)}>创建第一段对话</button>}
          </div>
        </section>)}
        {!loading && visibleProjects.length === 0 && <div className="history-empty">{search ? "没有匹配的项目或对话" : "还没有项目"}</div>}
      </nav>
      <ExecutionPermissions />
      <div className="debug-tools"><small>调试工具</small><button onClick={() => { setResetError(""); setResetDialog(true); }} disabled={loading || projectSaving}>清除所有记录</button></div>
      <div className="team-menu-wrap" ref={teamMenuRef} onKeyDown={(event) => { if (event.key === "Escape") setTeamMenu(false); }}>
        {teamMenu && <div className="team-menu" role="menu" aria-label="Agent 团队">
          <button role="menuitem" autoFocus onClick={() => { setTeamMenu(false); setResourceSettings(true); }}>服务连接与数据库<small>统一配置数据库、缓存等服务的地址和账号</small></button>
        </div>}
        <button className="sidebar-foot team-menu-trigger" aria-haspopup="menu" aria-expanded={teamMenu} onClick={() => setTeamMenu((open) => !open)}><span className="foot-mark">W</span><span>Agent 团队<small>{agents.length} 位成员已就位</small></span></button>
      </div>
    </aside>

    <section className="office" aria-label="Agent 办公室">
      <div className="creation-progress" aria-label="制作进度" role="status">
        <span className="creation-progress-label">制作进度</span>
        {progressLabels.map((label, index) => <span className={`creation-progress-step ${index < progressStep ? "complete" : index === progressStep ? "current" : ""}`} key={label}><i aria-hidden="true" />{label}</span>)}
      </div>
      <div className="office-content" inert={!!openFile}>
        <Suspense fallback={<div className="office-loading" role="status"><span aria-hidden="true" /><strong>正在准备办公场景</strong><small>首次加载 3D 资源可能需要一点时间</small></div>}>
          <OfficeScene agents={agents} />
        </Suspense>
      </div>
      {openFile && activeProject?.id === openFile.project && <DeliveryPreview key={`${openFile.project}:${openFile.path}`} project={openFile.project} path={openFile.path} revision={deliveryFiles.revision} status={deliveryFiles.status} onClose={() => setOpenFile(null)} onOpen={showFile} />}
    </section>

    <aside className="right-rail" aria-label="团队交流与工作日志">
      <div className="rail-tabs" role="tablist" aria-label="右侧内容">
        <button role="tab" aria-selected={panel === "chat"} className={panel === "chat" ? "active" : ""} onClick={() => setPanel("chat")}>团队群聊</button>
        <button role="tab" aria-selected={panel === "activity"} className={panel === "activity" ? "active" : ""} onClick={() => setPanel("activity")}>工作日志 <span>{active?.activities.length || 0}</span></button>
        <button role="tab" aria-selected={panel === "collaboration"} className={panel === "collaboration" ? "active" : ""} onClick={() => setPanel("collaboration")}>交付文档</button>
        <button role="tab" aria-selected={panel === "context"} className={panel === "context" ? "active" : ""} onClick={() => setPanel("context")}>Agent 上下文</button>
      </div>
      {panel === "collaboration" && activeProject ? <DeliveryPanel key={activeProject.id} files={deliveryFiles} selected={openFile?.path || null} onOpen={showFile} /> : !active ? <section className="chat-panel empty-conversation"><div className="chat-welcome"><span className="welcome-icon">W</span><strong>{activeProject ? activeProject.name : "开始使用 Wdrunge"}</strong><p>{activeProject ? "在此项目中创建一段对话。" : "先创建一个项目，团队会围绕项目工作区持续协作。"}</p><button onClick={() => activeProject ? void startConversation(activeProject.id) : setProjectDialog(true)}>{activeProject ? "新建对话" : "新建项目"}</button></div></section> : panel === "context" ? <AgentContextPanel key={active.id} conversation={active.id} /> : panel === "chat" ? <section className="chat-panel" role="tabpanel" aria-label="团队群聊">
        <header className="panel-heading"><div><strong>{active.project_name} · {active.title}</strong><span>{Object.values(teamIdentities).map((member) => member.name).join(" · ")}</span></div><div className="chat-heading-actions"><button aria-expanded={showCollaboration} onClick={() => setShowCollaboration(value => !value)}>{showCollaboration ? "返回群聊" : "任务与协作"}</button><span className="member-count">6 人</span></div></header>
        {showCollaboration ? <CollaborationPanel key={active.id} project={active.project_id} conversation={active.id} onOpen={showFile} /> : <>
        <div className="workspace-banner"><span title={active.workspace_path}>项目工作区 · {active.workspace_path}</span></div>
        <div className="chat-feed" ref={chatFeed} onScroll={event => {
          const feed = event.currentTarget;
          chatPosition.current = feed.scrollTop;
          followChat.current = feed.scrollHeight - feed.clientHeight - feed.scrollTop <= 32;
        }}>
          {active.messages.length === 0 && <div className="chat-welcome"><span className="welcome-icon">W</span><strong>开始一段对话</strong><p>向{memberName("leader")}发送消息。团队记录会保存在项目下。</p></div>}
          {active.messages.map((message) => <article className={`chat-message ${message.sender === "user" ? "mine" : ""}`} key={message.id}><AgentAvatar agent={message.sender} /><div className="message-body"><div className="message-meta"><strong>{nameOf(message.sender)}</strong><time>{message.time}</time></div><div className="bubble"><MessageContent message={message} /></div>{!!message.completedBy?.length && <div className="message-reactions" aria-label="任务完成状态">{message.completedBy.map((worker) => <span className="done-reaction" key={worker} title={`${nameOf(worker)}已完成`}><span aria-hidden="true">✓</span> Done · {nameOf(worker)}</span>)}</div>}</div></article>)}
          {canStop && <div className="processing"><i /><i /><i /><span>团队正在处理</span></div>}
        </div>
        {hasUserRequest && <details className="delivery-ready-card" aria-label="页面制作状态">
          <summary><div><span className="delivery-ready-spark" aria-hidden="true">✦</span><strong>{finalCheckReady ? "页面已准备好" : deliveryReady ? "页面正在检查" : "页面制作中"}</strong></div><span className="delivery-ready-meta"><small>{deliveryFiles.status === "live" ? "状态实时同步" : "正在连接项目文件"}</small><i aria-hidden="true">⌄</i></span></summary>
          <div className="delivery-ready-body">
            <div className="delivery-ready-checks">
              {[
                { label: "页面生成完成", done: deliveryReady, working: teamWorking && !deliveryReady },
                { label: "交互检查完成", done: review.accepted, working: review.checking },
                { label: "功能检查完成", done: finalCheckReady, working: review.checking || (deliveryReady && teamWorking) },
              ].map((item) => <span className={item.done ? "done" : item.working ? "working" : "waiting"} key={item.label}><i aria-hidden="true">{item.done ? "✓" : item.working ? "•" : "○"}</i>{item.label}<small>{item.done ? "已完成" : item.working ? "进行中" : "待检查"}</small></span>)}
            </div>
            <button type="button" disabled={!previewEntry} onClick={() => previewEntry && showFile(previewEntry.path)} title={previewEntry ? `预览 ${previewEntry.path}` : "生成交付文件后即可预览"}>打开预览 <span aria-hidden="true">↗</span></button>
          </div>
        </details>}
        <div className="composer-area">
          {activeExecution?.paused && <div className="composer-paused">
            <span role="status"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5v7m5-7v7" /></svg>上次任务已挂起</span>
            <button className="composer-resume" type="button" disabled={executionAction !== null} onClick={() => void controlExecution('resume')} title="手动继续当前会话的未完成任务">
              {executionAction === active.id ? <span className="composer-spinner" aria-hidden="true" /> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 6 4-6 4Z" /></svg>}
              继续任务
            </button>
          </div>}
          {error && <p className="error" role="alert">{error}</p>}
          <form className="composer" onSubmit={send}>
            <textarea aria-label="发送消息" placeholder="给团队发消息…" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={2} />
            <div className="prompt-controls" aria-label="补充页面要求">
              <details className="prompt-control">
                <summary className={interfaceStyle ? "selected" : ""}>界面风格{interfaceStyle && <span>{interfaceStyle}</span>}</summary>
                <div className="prompt-popover"><strong>选择界面风格</strong><small>会作为明确要求发送给团队</small>{interfaceStyles.map((style) => <button type="button" className={interfaceStyle === style ? "active" : ""} onClick={(event) => { setInterfaceStyle(interfaceStyle === style ? "" : style); event.currentTarget.closest("details")?.removeAttribute("open"); }} key={style}>{style}{interfaceStyle === style && <span>✓</span>}</button>)}</div>
              </details>
              <details className="prompt-control">
                <summary className={useScenario ? "selected" : ""}>使用场景{useScenario && <span>{useScenario}</span>}</summary>
                <div className="prompt-popover"><strong>选择使用场景</strong><small>帮助团队调整内容与信息层级</small>{useScenarios.map((scenario) => <button type="button" className={useScenario === scenario ? "active" : ""} onClick={(event) => { setUseScenario(useScenario === scenario ? "" : scenario); event.currentTarget.closest("details")?.removeAttribute("open"); }} key={scenario}>{scenario}{useScenario === scenario && <span>✓</span>}</button>)}</div>
              </details>
              <details className="prompt-control">
                <summary className={preferences.length ? "selected" : ""}>更多设置{preferences.length > 0 && <span>{preferences.length} 项</span>}</summary>
                <div className="prompt-popover prompt-popover-wide"><strong>开发偏好</strong><small>可多选，再次点击即可取消</small>{developmentPreferences.map((preference) => <button type="button" className={preferences.includes(preference) ? "active" : ""} onClick={() => setPreferences((current) => current.includes(preference) ? current.filter((item) => item !== preference) : [...current, preference])} key={preference}>{preference}{preferences.includes(preference) && <span>✓</span>}</button>)}</div>
              </details>
            </div>
            <div className="composer-bottom">
              <span>Enter 发送 · Shift + Enter 换行</span>
              {canStop ? <button className="composer-submit" type="button" disabled={executionAction !== null} onClick={() => void controlExecution('stop')} aria-label="停止生成" title="停止当前对话的生成、任务和运行进程">
                {executionAction === active.id ? <span className="composer-spinner" aria-hidden="true" /> : <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" /></svg>}
              </button> : <button className="composer-submit" type="submit" disabled={!input.trim() || streaming || executionAction !== null} aria-label="发送" title="发送消息">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5m-4 4 4-4 4 4" /></svg>
              </button>}
            </div>
          </form>
        </div>
        </>}
      </section> : <section className="log-panel" role="tabpanel" aria-label="工作日志">
        <div className="usage-dashboard"><SessionUsagePanel usage={active && sessionUsage?.conversation_id === active.id ? sessionUsage : null} nameOf={nameOf} allTokens={usage.total_tokens} /><div className="context-usage"><div className="context-heading" title="按模型每次回复返回的用量更新，界面每 3 秒同步；同一角色多实例显示最高上下文占用。">上下文窗口占用</div>{agents.map((agent) => { const item = usage.agents.find((member) => member.id === agent.id); const percent = item?.context_percent ?? 0; return <div className="context-row" key={agent.id} title={`${item?.context_tokens ?? 0} / ${item?.context_window ?? 131072} tokens`}><span title={nameOf(agent.id)}>{nameOf(agent.id)}</span><div className="context-track"><i style={{ width: `${Math.min(percent, 100)}%` }} /></div><strong>{percent.toFixed(1)}%</strong></div>; })}</div></div>
        <header className="panel-heading"><div><strong>工具调用时间线</strong><span>按时间记录 Agent 的工具调用</span></div><span className="member-count">{active.activities.length} 条</span></header>
        <div className="activity-feed">{active.activities.length === 0 ? <div className="activity-empty">暂无工具调用记录</div> : <ol className="timeline">{[...active.activities].reverse().map((item) => <li key={item.id}><span className="timeline-avatar"><AgentAvatar agent={item.agent} /><span className={`timeline-dot ${item.phase}`} /></span><div className="timeline-top"><strong>{nameOf(item.agent)}</strong><time>{item.time}</time></div><p>{item.description}</p><div className="timeline-foot"><code>{item.tool}</code><span className={`activity-phase ${item.phase}`}>{item.phase === "running" ? "进行中" : item.phase === "completed" ? "已完成" : "失败"}</span></div></li>)}</ol>}</div>
      </section>}
    </aside>

    {resourceSettings && <ResourceSettings projects={projects} activeProject={activeProject} onClose={() => setResourceSettings(false)} />}
    {resetDialog && <div className="workspace-dialog-backdrop" role="presentation"><section className="workspace-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description"><h2 id="reset-title">清除所有记录？</h2><div id="reset-description"><p>将停止正在执行的任务，并清除所有项目、对话、工作日志、协作请求、文档版本与订阅、消息、模型记忆和 Token 统计。</p><p>工作区中的实际文件会保留。已清除的记录无法撤销。</p></div>{resetError && <p className="workspace-dialog-error" role="alert">{resetError}</p>}<div className="workspace-dialog-actions"><button autoFocus onClick={() => setResetDialog(false)} disabled={resetting}>取消</button><button className="reset-confirm" onClick={() => void resetRecords()} disabled={resetting}>{resetting ? "正在停止任务并清除…" : "确认清除全部记录"}</button></div></section></div>}
    {projectDialog && <div className="workspace-dialog-backdrop" role="presentation"><form className="workspace-dialog" onSubmit={saveProject} role="dialog" aria-modal="true" aria-label="新建项目"><h2>新建项目</h2><p>项目对应一个本机工作区，并可以包含多段独立对话。</p><label htmlFor="project-name">项目名称</label><input id="project-name" autoFocus placeholder="默认使用文件夹名称" value={projectName} onChange={(event) => setProjectName(event.target.value)} /><label htmlFor="workspace-path">工作区目录</label><div className="workspace-picker"><input id="workspace-path" placeholder="选择或输入项目文件夹" value={workspaceDraft} onChange={(event) => setWorkspaceDraft(event.target.value)} /><button type="button" onClick={() => void chooseWorkspace()} disabled={!isTauri() || projectSaving}>{isTauri() ? "选择文件夹…" : "浏览器不支持选择"}</button></div>{!isTauri() && <small className="workspace-browser-hint">浏览器无法读取文件夹的真实绝对路径，请手动输入；桌面版可直接选择。</small>}{projectError && <p className="workspace-dialog-error" role="alert">{projectError}</p>}<div className="workspace-dialog-actions"><button type="button" onClick={() => setProjectDialog(false)} disabled={projectSaving}>取消</button><button type="submit" disabled={!workspaceDraft.trim() || projectSaving}>{projectSaving ? "创建中…" : "创建项目"}</button></div></form></div>}
  </main>;
}

export default App;
