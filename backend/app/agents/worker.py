"""A specialist worker with its own prompt, skills, and LangGraph tool loop."""

from collections.abc import AsyncIterator
from typing import Literal
from uuid import uuid4

from langchain_core.messages import AIMessageChunk, BaseMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from app.agents.base import Agent
from app.context import ContextCompressor

TOOL_LABELS = {
    "current_utc_time": "查看当前时间",
    "list_project_files": "查看项目文件列表",
    "read_project_file": "读取项目文件",
    "write_project_file": "更新项目文件",
    "refresh_api_contract": "更新接口文档",
    "refresh_frontend_client": "更新前端接口客户端",
    "run_project_check": "运行项目检查",
}


class WorkerAgent(Agent):
    def __init__(self, spec):
        super().__init__(spec)
        self._checkpointer = InMemorySaver()
        self._graph = None
        self._threads: dict[str, str] = {}
        self._context_by_session: dict[str, int] = {}
        self._compressor = ContextCompressor()

    def build_graph(self):
        if self._graph is not None:
            return self._graph
        model = self.model()
        tools = list(self.spec.tools)
        runnable = model.bind_tools(tools) if tools else model

        async def call_model(state: MessagesState):
            response = await runnable.ainvoke(state["messages"])
            return {"messages": [response]}

        graph = StateGraph(MessagesState)
        graph.add_node("agent", call_model)
        graph.add_edge(START, "agent")
        if tools:
            graph.add_node("tools", ToolNode(tools))
            graph.add_conditional_edges("agent", tools_condition)
            graph.add_edge("tools", "agent")
        else:
            graph.add_edge("agent", END)
        self._graph = graph.compile(checkpointer=self._checkpointer)
        return self._graph

    def resolve_context_mode(
        self, conversation_id: str, requested: Literal["auto", "fresh", "continue"]
    ) -> Literal["fresh", "continue"]:
        existing = conversation_id in self._threads
        if not existing or requested == "fresh":
            return "fresh"
        if requested == "continue":
            return "continue"
        used = self._context_by_session.get(conversation_id)
        if used is None:
            return "fresh"
        return "continue"

    async def discard_session(self, conversation_id: str) -> None:
        thread_id = self._threads.pop(conversation_id, None)
        self._context_by_session.pop(conversation_id, None)
        self._compressor.reset(conversation_id)
        if thread_id:
            await self._checkpointer.adelete_thread(thread_id)

    async def stream(
        self,
        task: str,
        *,
        conversation_id: str,
        context_mode: Literal["auto", "fresh", "continue"],
        handoff: str,
    ) -> AsyncIterator[tuple[str, dict]]:
        resolved = self.resolve_context_mode(conversation_id, context_mode)
        assignment = HumanMessage(
            content=f"Assigned task: {task}\n\nHandoff context:\n{handoff}"
        )
        compression = None
        compression_usage_changed = False
        if resolved == "fresh":
            await self.discard_session(conversation_id)
            self._threads[conversation_id] = uuid4().hex
            messages: list[BaseMessage] = [
                SystemMessage(content=self.system_prompt()),
                assignment,
            ]
        else:
            messages = [assignment]
            observed_tokens = self._context_by_session.get(conversation_id)
            level = self._compressor.policy.level_for(
                observed_tokens or 0, self.context_window()
            )
            if level:
                graph = self.build_graph()
                old_thread = self._threads[conversation_id]
                config = {"configurable": {"thread_id": old_thread}}
                snapshot = await graph.aget_state(config)
                saved = list(snapshot.values.get("messages", []))
                protected = []
                if saved and isinstance(saved[0], SystemMessage):
                    protected.append(saved.pop(0))
                if not protected:
                    protected.append(SystemMessage(content=self.system_prompt()))

                async def summarize_context(
                    request: str, _target_tokens: int
                ) -> str:
                    nonlocal compression_usage_changed
                    response = await self.summarize_context(request)
                    if self.record_usage(response):
                        compression_usage_changed = True
                    if not isinstance(response.content, str) or not response.content.strip():
                        raise RuntimeError("Context summarizer returned empty content")
                    return response.content.strip()

                compression = await self._compressor.prepare(
                    conversation_id=conversation_id,
                    protected_messages=protected,
                    history=[*saved, assignment],
                    context_window=self.context_window(),
                    summarize=summarize_context,
                    revision=old_thread,
                    observed_tokens=observed_tokens,
                )
                if compression.changed:
                    await self._checkpointer.adelete_thread(old_thread)
                    self._threads[conversation_id] = uuid4().hex
                    messages = compression.messages

        context_payload = {"mode": resolved}
        if compression and compression.changed:
            context_payload["compression_level"] = compression.level
        yield "context", context_payload
        if compression_usage_changed:
            yield "usage", {}
        tool_names = {tool.name for tool in self.spec.tools}
        active_tools: dict[str, str] = {}
        async for event in self.build_graph().astream_events(
            {"messages": messages},
            config={"configurable": {"thread_id": self._threads[conversation_id]}},
            version="v2",
        ):
            kind = event["event"]
            name = event.get("name", "")
            run_id = str(event.get("run_id", ""))
            if kind == "on_tool_start" and name in tool_names:
                active_tools[run_id] = name
                yield "activity", {
                    "id": run_id,
                    "tool": name,
                    "description": TOOL_LABELS.get(name, "调用工具"),
                    "phase": "running",
                }
            elif kind in {"on_tool_end", "on_tool_error"} and run_id in active_tools:
                tool_name = active_tools.pop(run_id)
                yield "activity", {
                    "id": run_id,
                    "tool": tool_name,
                    "description": TOOL_LABELS.get(tool_name, "调用工具"),
                    "phase": "failed" if kind == "on_tool_error" else "completed",
                }
            elif kind == "on_chat_model_stream" and event.get("metadata", {}).get("langgraph_node") == "agent":
                chunk = event.get("data", {}).get("chunk")
                if isinstance(chunk, AIMessageChunk) and isinstance(chunk.content, str) and chunk.content:
                    yield "content", {"content": chunk.content}
            elif kind == "on_chat_model_end" and event.get("metadata", {}).get("langgraph_node") == "agent":
                if self.record_usage(event.get("data", {}).get("output")):
                    self._context_by_session[conversation_id] = self.context_tokens
                    yield "usage", {}
