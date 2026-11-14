import type { AgentContextListResponse, AgentContextResponse, ConversationUsageResponse, TeamMemberResponse, TeamStatusResponse, TeamUsageResponse } from "./generated";
import { untitledConversation } from "./conversationTitle";

export type TeamMember = TeamMemberResponse;
export type TeamUsage = TeamUsageResponse;
export type TeamMention = {
  worker: string;
  name: string;
  summary: string;
};
export type TeamChatMessage = {
  id: string;
  sender: string;
  content: string;
  mention?: string;
  mentions?: TeamMention[];
};
export type ReadReceipt = {
  message_id: string;
  reader: string;
};
export type MessageReaction = {
  message_id: string;
  worker: string;
  reaction: "done";
};
export type Activity = {
  id: string;
  agent: string;
  tool: string;
  description: string;
  phase: "running" | "completed" | "failed";
};
export type StreamCallbacks = {
  onDelta: (content: string, messageId?: string) => void;
  onStatus?: (status: Pick<TeamMember, "id" | "status">) => void;
  onMessage?: (message: TeamChatMessage) => void;
  onRead?: (receipt: ReadReceipt) => void;
  onReaction?: (reaction: MessageReaction) => void;
  onActivity?: (activity: Activity) => void;
  onUsage?: (usage: TeamUsage) => void;
  onTitle?: (title: string) => void;
};

export type ConversationSummary = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
  conversations: ConversationSummary[];
};

export type PersistedMessage = TeamChatMessage & {
  kind: string;
  status: string;
  sequence: number;
  read_by: string[];
  completed_by: string[];
  created_at: string;
};

export type PersistedActivity = Activity & {
  sequence: number;
  created_at: string;
};

export type ConversationDetail = ConversationSummary & {
  project_name: string;
  workspace_path: string;
  messages: PersistedMessage[];
  activities: PersistedActivity[];
};

export type CollaborationRequestStatus = {
  conversation?: string;
  recipient?: string;
  state: string;
  created?: number;
  origin_message?: string;
  verification?: string;
};

export type CollaborationSnapshot = {
  request?: CollaborationRequestStatus[];
};

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:17420"
).replace(/\/$/, "");

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  const data = await response.json().catch(() => ({})) as T & { detail?: string };
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status})`);
  return data;
}

export type ConversationEvent = { sequence: number; type: string; payload: Record<string, unknown>; created_at: string };
export async function getConversationEvents(id: string, after: number, signal?: AbortSignal) {
  return requestJson<{events: ConversationEvent[]; cursor: number; has_more: boolean}>(
    `/api/conversations/${encodeURIComponent(id)}/events?after=${after}`, { signal });
}

export type SessionUsage = ConversationUsageResponse;

export function getConversationUsage(id: string, signal?: AbortSignal): Promise<SessionUsage> {
  return requestJson<SessionUsage>(`/api/conversations/${encodeURIComponent(id)}/usage`, { signal });
}

export type { AgentContextMessage, AgentContextSummary, AgentContextToolCall } from "./generated";

export function listAgentContexts(id: string, signal?: AbortSignal): Promise<AgentContextListResponse> {
  return requestJson<AgentContextListResponse>(`/api/conversations/${encodeURIComponent(id)}/agent-contexts`, { signal });
}

/** With the last revision, an unchanged context returns no messages. */
export function getAgentContext(id: string, key: string, revision?: string, signal?: AbortSignal): Promise<AgentContextResponse> {
  const query = new URLSearchParams({ key, ...(revision ? { revision } : {}) });
  return requestJson<AgentContextResponse>(`/api/conversations/${encodeURIComponent(id)}/agent-context?${query}`, { signal });
}

export async function getTeamStatus(signal?: AbortSignal): Promise<TeamStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/team`, { signal });
  if (!response.ok) throw new Error(`Team status failed (${response.status})`);
  return (await response.json()) as TeamStatusResponse;
}

export async function validateWorkspace(path: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/workspaces/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = await response.json() as { path?: string; detail?: string };
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Workspace validation failed (${response.status})`);
  if (!data.path) throw new Error("Workspace validation did not return a path.");
  return data.path;
}

export function listProjects(signal?: AbortSignal): Promise<ProjectSummary[]> {
  return requestJson<ProjectSummary[]>("/api/projects", { signal });
}

export function getCollaborationSnapshot(projectId: string, signal?: AbortSignal): Promise<CollaborationSnapshot> {
  return requestJson<CollaborationSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/collaboration`, { signal });
}

export function createProject(name: string, workspacePath: string): Promise<ProjectSummary> {
  return requestJson<ProjectSummary>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() || undefined, workspace_path: workspacePath }),
  });
}

export function createConversation(projectId: string): Promise<ConversationSummary> {
  return requestJson<ConversationSummary>(`/api/projects/${projectId}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: untitledConversation }),
  });
}

export function getConversation(conversationId: string, signal?: AbortSignal): Promise<ConversationDetail> {
  return requestJson<ConversationDetail>(`/api/conversations/${conversationId}`, { signal });
}

export async function streamConversationMessage(
  conversationId: string,
  content: string,
  clientMessageId: string,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, client_message_id: clientMessageId }),
    signal,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { detail?: string };
      if (typeof data.detail === "string") message = data.detail;
    } catch {
      // Keep the status message when the server did not return JSON.
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("The server did not return a stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;

  function dispatch(frame: string) {
    const lines = frame.split("\n");
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
    const data = lines
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    if (!event || !data) return;

    const payload = JSON.parse(data) as {
      content?: string;
      message?: string;
      id?: string;
      status?: TeamMember["status"];
      sender?: string;
      mention?: string;
      mentions?: TeamMention[];
      message_id?: string;
      reader?: string;
      worker?: string;
      reaction?: string;
      agent?: string;
      tool?: string;
      description?: string;
      phase?: Activity["phase"];
      total_tokens?: number;
      cache_input_tokens?: number;
      cached_tokens?: number;
      cache_percent?: number | null;
      agents?: TeamUsage["agents"];
      title?: string;
    };
    if (event === "delta" && payload.content) callbacks.onDelta(payload.content, payload.message_id);
    if (event === "status" && payload.id && payload.status) {
      callbacks.onStatus?.({ id: payload.id, status: payload.status });
    }
    if (event === "chat_message" && payload.id && payload.sender && payload.content) {
      callbacks.onMessage?.({ id: payload.id, sender: payload.sender, content: payload.content, mention: payload.mention, mentions: payload.mentions });
    }
    if (event === "read_receipt" && payload.message_id && payload.reader) {
      callbacks.onRead?.({ message_id: payload.message_id, reader: payload.reader });
    }
    if (event === "message_reaction" && payload.message_id && payload.worker && payload.reaction === "done") {
      callbacks.onReaction?.({ message_id: payload.message_id, worker: payload.worker, reaction: "done" });
    }
    if (event === "activity" && payload.id && payload.agent && payload.tool && payload.description && payload.phase) {
      callbacks.onActivity?.({ id: payload.id, agent: payload.agent, tool: payload.tool, description: payload.description, phase: payload.phase });
    }
    if (event === "usage" && typeof payload.total_tokens === "number" && Array.isArray(payload.agents)) {
      callbacks.onUsage?.({ total_tokens: payload.total_tokens, cache_input_tokens: payload.cache_input_tokens,
        cached_tokens: payload.cached_tokens, cache_percent: payload.cache_percent, agents: payload.agents });
    }
    if (event === "title" && payload.title) callbacks.onTitle?.(payload.title);
    if (event === "error") throw new Error(payload.message || "Agent request failed");
    if (event === "done") complete = true;
  }

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (!complete) throw new Error("The response ended before completion");
  } finally {
    reader.releaseLock();
  }
}

export function clearAllRecords(): Promise<{ cleared: boolean; workspace_files_preserved: boolean }> {
  return requestJson("/api/debug/records/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "CLEAR_ALL_RECORDS" }),
  });
}

export type ConversationExecution = {
  running: boolean;
  stopping: boolean;
  paused: boolean;
  pending_tasks: number;
  active_goals: number;
  task_states?: Record<string, number>;
  leader_running?: boolean;
};

export function executionLabel(state: ConversationExecution | undefined, streaming: boolean): string {
  if (state?.stopping) return 'Stopping tasks…';
  const tasks = state?.task_states;
  if (tasks?.running) return `Team working · ${tasks.running} active`;
  if (tasks?.review) return `Code delivered · ${tasks.review} awaiting Leader review`;
  if (tasks?.blocked) return `Waiting on dependencies or blockers · ${tasks.blocked} blocked`;
  if (tasks?.queued) return `Tasks queued · ${tasks.queued}`;
  if (state?.leader_running || streaming) return 'Leader is working';
  if (state?.active_goals) return 'Waiting for goal completion';
  return 'Syncing task status…';
}
export function getConversationExecution(id: string, signal?: AbortSignal): Promise<ConversationExecution> {
  return requestJson(`/api/conversations/${encodeURIComponent(id)}/execution`, { signal });
}
export function stopConversationExecution(id: string): Promise<ConversationExecution> {
  return requestJson(`/api/conversations/${encodeURIComponent(id)}/execution/stop`, { method: 'POST' });
}
export function resumeConversationExecution(id: string): Promise<ConversationExecution> {
  return requestJson(`/api/conversations/${encodeURIComponent(id)}/execution/resume`, { method: 'POST' });
}

export function pausePreviousExecution(keepalive = false): Promise<{ paused_conversations: number }> {
  return requestJson('/api/execution/pause', { method: 'POST', keepalive });
}
