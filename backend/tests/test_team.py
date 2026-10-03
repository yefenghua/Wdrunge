import asyncio

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.agents.base import AgentSpec
from app.agents.team import Team
from app.agents.worker import WorkerAgent
from app.tools import _workspace
from app.tools.current_utc_time import current_utc_time


def run_team(team: Team):
    async def collect():
        return [event async for event in team.stream([HumanMessage(content="你好")])]

    return asyncio.run(collect())


def test_leader_exposes_delegation_as_optional_function_call(monkeypatch):
    leader = Team().leader

    class FakeModel:
        def __init__(self):
            self.bound_tools = []

        def bind_tools(self, tools, tool_choice):
            assert tool_choice == "auto"
            self.bound_tools = [tool.name for tool in tools]
            return self

        async def ainvoke(self, _messages):
            return AIMessage(content="你好！")

    fake = FakeModel()
    monkeypatch.setattr(leader, "model", lambda: fake)
    result = asyncio.run(leader.next_message([HumanMessage(content="你好")]))
    assert fake.bound_tools == ["delegate_task", "delegate_tasks", "checkpoint_context"]
    assert result.content == "你好！"


def test_workers_expose_safe_project_file_tools():
    team = Team()
    expected = {
        "list_project_files",
        "read_project_file",
        "create_project_directory",
        "write_project_file",
        "replace_project_text",
    }

    for worker in team.workers.values():
        assert expected <= {tool.name for tool in worker.spec.tools}


def test_worker_prompts_require_safe_existing_file_edits():
    team = Team()

    for worker in team.workers.values():
        prompt = worker.system_prompt()
        assert "read_project_file" in prompt
        assert "replace_project_text" in prompt
        assert "write_project_file" in prompt


def test_leader_can_answer_greeting_without_dispatch(monkeypatch):
    team = Team()

    async def answer(_messages, *, allow_delegation=True):
        assert allow_delegation
        return AIMessage(content="你好！")

    monkeypatch.setattr(team.leader, "next_message", answer)
    events = run_team(team)
    assert not any(event == "chat_message" for event, _ in events)
    assert ("delta", {"role": "leader", "content": "你好！"}) in events
    assert all(agent["status"] == "idle" for agent in team.snapshot())


def test_reported_token_usage_updates_total_and_context_percentage(monkeypatch):
    team = Team()
    team.leader.spec = AgentSpec(id="leader", name="Leader", prompt_file="leader.md", context_window=1000)

    async def answer(_messages, *, allow_delegation=True):
        return AIMessage(content="你好！", usage_metadata={"input_tokens": 250, "output_tokens": 25, "total_tokens": 275})

    monkeypatch.setattr(team.leader, "next_message", answer)
    events = run_team(team)
    usage = [payload for event, payload in events if event == "usage"]
    assert len(usage) == 1
    assert usage[0]["total_tokens"] == 275
    assert usage[0]["agents"][0]["context_tokens"] == 250
    assert usage[0]["agents"][0]["context_percent"] == 25.0


def test_leader_dispatches_and_receives_worker_results(monkeypatch):
    team = Team()
    calls = []

    async def next_message(messages, *, allow_delegation=True):
        tool_results = [message for message in messages if isinstance(message, ToolMessage)]
        if not tool_results:
            return AIMessage(
                content="",
                tool_calls=[{
                    "name": "delegate_task",
                    "args": {"worker": "designer", "task": "Design UI", "summary": "设计界面", "handoff": "Design the requested UI"},
                    "id": "call-design",
                }],
            )
        if len(tool_results) == 1:
            assert "design complete" in tool_results[0].content
            return AIMessage(
                content="",
                tool_calls=[{
                    "name": "delegate_task",
                    "args": {"worker": "frontend", "task": "Build the designed UI", "summary": "实现设计好的界面", "handoff": "Use the completed design"},
                    "id": "call-front",
                }],
            )
        assert "frontend complete" in tool_results[1].content
        return AIMessage(content="设计和前端都已完成。")

    async def design(task, *, conversation_id, context_mode, handoff):
        calls.append(("designer", task))
        assert handoff.endswith("Design the requested UI")
        assert "Project workspace:" in handoff
        yield "content", {"content": "design complete"}

    async def frontend(task, *, conversation_id, context_mode, handoff):
        calls.append(("frontend", task))
        assert handoff.endswith("Use the completed design")
        yield "content", {"content": "frontend complete"}

    monkeypatch.setattr(team.leader, "next_message", next_message)
    monkeypatch.setattr(team.workers["designer"], "stream", design)
    monkeypatch.setattr(team.workers["frontend"], "stream", frontend)
    events = run_team(team)
    assert [call[0] for call in calls] == ["designer", "frontend"]
    mentions = [data for event, data in events if event == "chat_message" and "mentions" in data]
    assert [[item["worker"] for item in data["mentions"]] for data in mentions] == [["designer"], ["frontend"]]
    assert all("task" not in data for data in mentions)
    assert [data["message_id"] for event, data in events if event == "read_receipt"] == [
        data["id"] for data in mentions
    ]
    assert len({data["id"] for data in mentions}) == 2
    assert [(data["message_id"], data["worker"]) for event, data in events if event == "message_reaction"] == [
        (mentions[0]["id"], "designer"), (mentions[1]["id"], "frontend")
    ]
    assert not any(event == "chat_message" and data["content"] == "这部分已完成，交给 Leader 汇总。" for event, data in events)
    assert not any(event == "delta" and data.get("role") != "leader" for event, data in events)
    assert [data["tool"] for event, data in events if event == "activity" and data["phase"] == "completed"] == ["delegate_task", "delegate_task"]
    assert ("delta", {"role": "leader", "content": "设计和前端都已完成。"}) in events
    assert all(agent["status"] == "idle" for agent in team.snapshot())


def test_batch_delegations_run_concurrently_and_show_public_summaries(monkeypatch):
    team = Team()
    both_started = asyncio.Event()
    started: set[str] = set()

    async def next_message(messages, *, allow_delegation=True):
        results = [message for message in messages if isinstance(message, ToolMessage)]
        if not results:
            return AIMessage(content="", tool_calls=[{
                "name": "delegate_tasks",
                "args": {"assignments": [
                    {"worker": "product", "task": "private greeting parameters", "summary": "给老板打个招呼", "handoff": "Greeting requested"},
                    {"worker": "backend", "task": "private tea parameters", "summary": "给老板端茶倒水", "handoff": "Tea requested"},
                ]},
                "id": "batch-1",
            }])
        assert len(results) == 1
        assert "product: greeting done" in results[0].content
        assert "backend: tea done" in results[0].content
        return AIMessage(content="两位成员都完成了。")

    async def worker_stream(role, result):
        started.add(role)
        if len(started) == 2:
            both_started.set()
        await both_started.wait()
        yield "content", {"content": result}

    async def product(_task, *, conversation_id, context_mode, handoff):
        async for item in worker_stream("product", "greeting done"):
            yield item

    async def backend(_task, *, conversation_id, context_mode, handoff):
        async for item in worker_stream("backend", "tea done"):
            yield item

    monkeypatch.setattr(team.leader, "next_message", next_message)
    monkeypatch.setattr(team.workers["product"], "stream", product)
    monkeypatch.setattr(team.workers["backend"], "stream", backend)

    async def collect():
        return [event async for event in team.stream([HumanMessage(content="请安排两件事")])]

    events = asyncio.run(asyncio.wait_for(collect(), timeout=1))
    mentions = [payload for event, payload in events if event == "chat_message" and "mentions" in payload]
    assert len(mentions) == 1
    assert mentions[0]["content"] == "@产品 给老板打个招呼\n@后端开发 给老板端茶倒水"
    assert [item["worker"] for item in mentions[0]["mentions"]] == ["product", "backend"]
    assert [(data["message_id"], data["reader"]) for event, data in events if event == "read_receipt"] == [
        (mentions[0]["id"], "product"), (mentions[0]["id"], "backend")
    ]
    assert {(data["message_id"], data["worker"], data["reaction"]) for event, data in events if event == "message_reaction"} == {
        (mentions[0]["id"], "product", "done"), (mentions[0]["id"], "backend", "done")
    }
    chat_senders = [data["sender"] for event, data in events if event == "chat_message"]
    assert chat_senders[0] == "leader"
    assert set(chat_senders[1:]) == {"product", "backend"}
    assert len(chat_senders) == 3
    assert "private" not in str(events)
    assert [payload["tool"] for event, payload in events if event == "activity" and payload["phase"] == "completed"] == ["delegate_tasks", "delegate_tasks"]
    assert ("delta", {"role": "leader", "content": "两位成员都完成了。"}) in events


def test_empty_direct_reply_retries_without_tools(monkeypatch):
    team = Team()
    calls = []

    async def next_message(_messages, *, allow_delegation=True):
        calls.append(allow_delegation)
        return AIMessage(content="" if allow_delegation else "你好！")

    monkeypatch.setattr(team.leader, "next_message", next_message)
    events = run_team(team)
    assert calls == [True, False]
    assert ("delta", {"role": "leader", "content": "你好！"}) in events


def test_closing_stream_resets_running_member(monkeypatch):
    team = Team()

    async def next_message(_messages, *, allow_delegation=True):
        return AIMessage(
            content="",
            tool_calls=[{
                "name": "delegate_task",
                "args": {"worker": "frontend", "task": "Build UI", "summary": "实现界面", "handoff": "Build the UI"},
                "id": "call-front",
            }],
        )

    async def frontend(_task, *, conversation_id, context_mode, handoff):
        yield "activity", {"id": "tool-1", "tool": "read_project_file", "description": "读取项目文件", "phase": "running"}
        yield "content", {"content": "second chunk"}

    monkeypatch.setattr(team.leader, "next_message", next_message)
    monkeypatch.setattr(team.workers["frontend"], "stream", frontend)

    async def stop_mid_stream():
        stream = team.stream([HumanMessage(content="Build UI")])
        async for event, payload in stream:
            if event == "activity" and payload["id"] == "tool-1":
                await stream.aclose()
                break

    asyncio.run(stop_mid_stream())
    assert all(agent["status"] == "idle" for agent in team.snapshot())


def test_worker_stream_reports_tool_use_without_arguments(monkeypatch):
    worker = WorkerAgent(AgentSpec(id="product", name="产品", prompt_file="product.md", tools=(current_utc_time,)))

    class FakeGraph:
        async def astream_events(self, _state, *, config, version):
            assert version == "v2"
            yield {"event": "on_tool_start", "name": "current_utc_time", "run_id": "tool-1", "data": {"input": {"secret": "hidden"}}}
            yield {"event": "on_tool_end", "name": "current_utc_time", "run_id": "tool-1", "data": {"output": "secret output"}}

    monkeypatch.setattr(worker, "build_graph", lambda: FakeGraph())

    async def collect():
        return [event async for event in worker.stream("private task", conversation_id="chat-1", context_mode="fresh", handoff="Goal and constraints")]

    events = asyncio.run(collect())
    assert events == [
        ("context", {"mode": "fresh"}),
        ("activity", {"id": "tool-1", "tool": "current_utc_time", "description": "查看当前时间", "phase": "running"}),
        ("activity", {"id": "tool-1", "tool": "current_utc_time", "description": "查看当前时间", "phase": "completed"}),
    ]


def test_worker_reports_model_usage_after_loop(monkeypatch):
    worker = WorkerAgent(AgentSpec(id="product", name="产品", prompt_file="product.md"))

    class FakeGraph:
        async def astream_events(self, _state, *, config, version):
            yield {"event": "on_chat_model_end", "name": "model", "metadata": {"langgraph_node": "agent"},
                   "data": {"output": AIMessage(content="done", usage_metadata={"input_tokens": 40, "output_tokens": 5, "total_tokens": 45})}}

    monkeypatch.setattr(worker, "build_graph", lambda: FakeGraph())

    async def collect():
        return [event async for event in worker.stream("task", conversation_id="chat-1", context_mode="fresh", handoff="Goal")]

    assert asyncio.run(collect()) == [("context", {"mode": "fresh"}), ("usage", {})]
    assert worker.total_tokens == 45
    assert worker.context_tokens == 40


def test_worker_context_modes_keep_sessions_isolated(monkeypatch):
    worker = WorkerAgent(AgentSpec(id="product", name="产品", prompt_file="product.md"))
    calls = []

    class FakeGraph:
        async def astream_events(self, state, *, config, version):
            calls.append((state["messages"], config["configurable"]["thread_id"]))
            yield {"event": "on_chat_model_end", "name": "model", "metadata": {"langgraph_node": "agent"},
                   "data": {"output": AIMessage(content="done", usage_metadata={"input_tokens": 100, "output_tokens": 5, "total_tokens": 105})}}

    monkeypatch.setattr(worker, "build_graph", lambda: FakeGraph())

    async def collect(chat, mode, task):
        return [event async for event in worker.stream(task, conversation_id=chat, context_mode=mode, handoff=f"Handoff for {task}")]

    async def sequence():
        assert ("context", {"mode": "fresh"}) in await collect("chat-a", "fresh", "first")
        assert ("context", {"mode": "continue"}) in await collect("chat-a", "continue", "second")
        assert ("context", {"mode": "fresh"}) in await collect("chat-b", "continue", "other chat")
        assert ("context", {"mode": "fresh"}) in await collect("chat-a", "fresh", "reset")

    asyncio.run(sequence())
    assert calls[0][1] == calls[1][1]
    assert calls[2][1] != calls[0][1]
    assert calls[3][1] != calls[0][1]
    assert isinstance(calls[0][0][0], SystemMessage)
    assert len(calls[1][0]) == 1
    assert "second" in calls[1][0][0].content
    assert "first" not in calls[1][0][0].content
    assert isinstance(calls[3][0][0], SystemMessage)
    assert "first" not in str(calls[3][0])


def test_auto_starts_fresh_at_sixty_percent_of_context_window():
    worker = WorkerAgent(AgentSpec(id="product", name="产品", prompt_file="product.md", context_window=100))
    assert worker.resolve_context_mode("chat-a", "auto") == "fresh"
    worker._threads["chat-a"] = "thread-a"
    assert worker.resolve_context_mode("chat-a", "auto") == "fresh"
    worker._context_by_session["chat-a"] = 59
    assert worker.resolve_context_mode("chat-a", "auto") == "continue"
    worker._context_by_session["chat-a"] = 60
    assert worker.resolve_context_mode("chat-a", "auto") == "fresh"
    assert worker.resolve_context_mode("chat-a", "continue") == "continue"


def test_langgraph_checkpoint_resumes_messages_without_remote_model(monkeypatch):
    worker = WorkerAgent(AgentSpec(id="product", name="产品", prompt_file="product.md"))
    seen = []

    class FakeModel:
        async def ainvoke(self, messages):
            seen.append([message.content for message in messages])
            return AIMessage(content="local result")

    monkeypatch.setattr(worker, "model", lambda: FakeModel())

    async def collect(mode, task):
        return [event async for event in worker.stream(task, conversation_id="chat-a", context_mode=mode, handoff=f"Handoff: {task}")]

    async def sequence():
        await collect("fresh", "first task")
        await collect("continue", "second task")
        await collect("fresh", "third task")

    asyncio.run(sequence())
    assert any("first task" in content for content in seen[1])
    assert any("local result" == content for content in seen[1])
    assert any("second task" in content for content in seen[1])
    assert not any("first task" in content for content in seen[2])
    assert any("third task" in content for content in seen[2])


def test_leader_checkpoint_replaces_old_history_only_for_its_chat(monkeypatch):
    team = Team()
    seen = []

    async def next_message(messages, *, allow_delegation=True):
        seen.append(messages)
        if any(isinstance(message, HumanMessage) and message.content == "阶段完成" for message in messages) and not any(isinstance(message, ToolMessage) for message in messages):
            return AIMessage(content="", tool_calls=[{
                "name": "checkpoint_context",
                "args": {"goal": "完成项目", "constraints": ["黑白灰界面"], "artifacts": ["docs/product/spec.md"], "completed": ["产品设计"], "pending": ["后端实现"]},
                "id": "checkpoint-1",
            }])
        return AIMessage(content="收到")

    monkeypatch.setattr(team.leader, "next_message", next_message)

    async def collect(history, chat):
        return [item async for item in team.stream(history, conversation_id=chat)]

    async def sequence():
        await collect([HumanMessage(content="阶段完成")], "chat-a")
        await collect([HumanMessage(content="阶段完成"), AIMessage(content="收到"), HumanMessage(content="继续后端")], "chat-a")
        await collect([HumanMessage(content="阶段完成"), AIMessage(content="收到"), HumanMessage(content="另一聊天")], "chat-b")

    asyncio.run(sequence())
    resumed = seen[2]
    assert "Goal: 完成项目" in resumed[1].content
    assert "docs/product/spec.md" in resumed[1].content
    assert not any(isinstance(message, HumanMessage) and message.content == "阶段完成" for message in resumed)
    assert any(isinstance(message, HumanMessage) and message.content == "继续后端" for message in resumed)
    assert any(isinstance(message, HumanMessage) and message.content == "阶段完成" for message in seen[3])


def test_worker_failure_finishes_batch_even_if_session_cleanup_fails(monkeypatch):
    team = Team()

    async def next_message(_messages, *, allow_delegation=True):
        return AIMessage(content="", tool_calls=[{
            "name": "delegate_task",
            "args": {"worker": "backend", "task": "Implement API", "summary": "实现接口", "handoff": "API requirements"},
            "id": "call-backend",
        }])

    async def failing_worker(_task, *, conversation_id, context_mode, handoff):
        raise RuntimeError("worker failed")
        yield  # Keep this an async generator.

    async def failing_cleanup(_conversation_id):
        raise RuntimeError("cleanup failed")

    monkeypatch.setattr(team.leader, "next_message", next_message)
    monkeypatch.setattr(team.workers["backend"], "stream", failing_worker)
    monkeypatch.setattr(team.workers["backend"], "discard_session", failing_cleanup)

    async def collect():
        return [event async for event in team.stream([HumanMessage(content="实现接口")], conversation_id="chat-a")]

    with pytest.raises(RuntimeError, match="worker failed"):
        asyncio.run(asyncio.wait_for(collect(), timeout=1))


def test_team_stream_scopes_each_conversation_to_its_workspace(tmp_path, monkeypatch):
    team = Team()
    observed = []

    async def answer(messages, *, allow_delegation=True):
        observed.append((_workspace.workspace_root(), messages[0].content))
        return AIMessage(content="done")

    monkeypatch.setattr(team.leader, "next_message", answer)

    async def collect(path, conversation_id):
        return [event async for event in team.stream(
            [HumanMessage(content="hello")], conversation_id=conversation_id, workspace_path=path,
        )]

    first = tmp_path / "one"
    second = tmp_path / "two"
    first.mkdir()
    second.mkdir()
    asyncio.run(collect(first, "one"))
    asyncio.run(collect(second, "two"))
    assert [path for path, _ in observed] == [first, second]
    assert all(str(path) in prompt for path, prompt in observed)
    assert _workspace.active_workspace.get() is None
