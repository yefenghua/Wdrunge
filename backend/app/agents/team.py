"""Team registry and leader-coordinated parallel specialist handoffs."""

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from functools import lru_cache
from uuid import uuid4

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, ToolMessage
from pydantic import ValidationError

from app.agents.base import AgentSpec, AgentStatus
from app.agents.leader import LeaderAgent
from app.agents.worker import WorkerAgent
from app.context import ContextCompressor
from app.tools.current_utc_time import current_utc_time
from app.tools.checkpoint_context import ContextCheckpoint, checkpoint_context
from app.tools.delegate_task import Delegation, delegate_task
from app.tools.delegate_tasks import DelegationBatch, delegate_tasks
from app.tools.list_project_files import make_list_project_files
from app.tools.read_project_file import make_read_project_file
from app.tools.refresh_api_contract import refresh_api_contract
from app.tools.refresh_frontend_client import refresh_frontend_client
from app.tools.run_project_check import run_project_check
from app.tools.write_project_file import make_write_project_file


ROLE_CONFIG = {
    "product": {
        "name": "产品",
        "prompt": "product.md",
        "skills": ("requirements.md",),
        "read": ("docs", "README.md", "backend/openapi.json"),
        "write": ("docs/product",),
    },
    "backend": {
        "name": "后端开发",
        "prompt": "backend.md",
        "skills": ("api_contract.md",),
        "read": ("docs", "backend/app", "backend/pyproject.toml", "backend/tests"),
        "write": ("backend/app", "docs/backend"),
    },
    "designer": {
        "name": "美工",
        "prompt": "designer.md",
        "skills": ("visual_design.md",),
        "read": ("docs", "frontend/src", "frontend/public"),
        "write": ("frontend/src", "frontend/public", "docs/design"),
    },
    "frontend": {
        "name": "前端开发",
        "prompt": "frontend.md",
        "skills": ("api_contract.md",),
        "read": ("docs", "frontend/src", "frontend/public", "backend/openapi.json"),
        "write": ("frontend/src", "docs/frontend"),
    },
    "testing": {
        "name": "测试",
        "prompt": "testing.md",
        "skills": ("test_strategy.md",),
        "read": ("docs", "backend/app", "backend/tests", "frontend/src", "backend/openapi.json"),
        "write": ("backend/tests", "frontend/tests", "docs/testing"),
    },
}

WORKER_ACK = {
    "product": "收到，我先整理产品需求。",
    "backend": "收到，我马上开始后端开发。",
    "designer": "收到，我来处理视觉设计。",
    "frontend": "收到，我马上开始前端开发。",
    "testing": "收到，我来检查和测试。",
}

MAX_DELEGATIONS = 12
logger = logging.getLogger(__name__)


@dataclass
class LeaderCheckpoint:
    handoff: ContextCheckpoint
    history_cutoff: int


def message_text(message: BaseMessage) -> str:
    if isinstance(message.content, str):
        return message.content
    return "".join(
        part.get("text", "") for part in message.content if isinstance(part, dict)
    )


class Team:
    def __init__(self):
        self.leader = LeaderAgent(
            AgentSpec(
                id="leader", name="Leader", prompt_file="leader.md", tools=(delegate_task, delegate_tasks, checkpoint_context)
            )
        )
        self.workers: dict[str, WorkerAgent] = {}
        for role, config in ROLE_CONFIG.items():
            read_roots = config["read"]
            write_roots = config["write"]
            tools = (
                make_list_project_files(read_roots),
                make_read_project_file(read_roots),
                make_write_project_file(write_roots),
            )
            if role == "testing":
                tools += (run_project_check,)
            if role == "backend":
                tools += (refresh_api_contract,)
            if role == "frontend":
                tools += (refresh_frontend_client,)
            if role == "product":
                tools += (current_utc_time,)
            worker = WorkerAgent(
                AgentSpec(
                    id=role,
                    name=config["name"],
                    prompt_file=config["prompt"],
                    tools=tools,
                    skills=config["skills"],
                )
            )
            worker.system_prompt()  # Validate prompt and skill files during startup.
            self.workers[role] = worker
        self.leader.system_prompt()
        self._lock = asyncio.Lock()
        self._leader_checkpoints: dict[str, LeaderCheckpoint] = {}
        self._leader_compressor = ContextCompressor()

    def snapshot(self) -> list[dict]:
        return [self.leader.snapshot(), *(worker.snapshot() for worker in self.workers.values())]

    def usage_snapshot(self) -> dict:
        members = [self.leader.usage_snapshot(), *(worker.usage_snapshot() for worker in self.workers.values())]
        return {"total_tokens": sum(member["total_tokens"] for member in members), "agents": members}

    async def stream(
        self, history: list[BaseMessage], *, conversation_id: str | None = None
    ) -> AsyncIterator[tuple[str, dict]]:
        """Let the Leader reply or function-call specialists as needed."""
        session_id = conversation_id or uuid4().hex
        async with self._lock:
            try:
                async for event in self._run(history, session_id):
                    yield event
            finally:
                for agent in (self.leader, *self.workers.values()):
                    if agent.status == AgentStatus.RUNNING:
                        agent.status = AgentStatus.IDLE

    async def _run(self, history: list[BaseMessage], conversation_id: str) -> AsyncIterator[tuple[str, dict]]:
        self.leader.status = AgentStatus.RUNNING
        yield "status", {"id": "leader", "status": AgentStatus.RUNNING}
        system = SystemMessage(content=self.leader.system_prompt())
        checkpoint = self._leader_checkpoints.get(conversation_id)
        protected: list[BaseMessage] = [system]
        history_start = 0
        revision = "raw"
        if checkpoint and checkpoint.history_cutoff < len(history):
            protected.append(SystemMessage(content=checkpoint.handoff.as_prompt()))
            history_start = checkpoint.history_cutoff
            revision = f"checkpoint:{checkpoint.history_cutoff}"

        compression_usage_changed = False

        async def summarize_context(request: str, _target_tokens: int) -> str:
            nonlocal compression_usage_changed
            response = await self.leader.summarize_context(request)
            if self.leader.record_usage(response):
                compression_usage_changed = True
            content = message_text(response).strip()
            if not content:
                raise RuntimeError("Context summarizer returned empty content")
            return content

        compression = await self._leader_compressor.prepare(
            conversation_id=conversation_id,
            protected_messages=protected,
            history=history[history_start:],
            context_window=self.leader.context_window(),
            summarize=summarize_context,
            revision=revision,
            observed_tokens=self.leader.context_tokens or None,
        )
        messages = compression.messages
        if compression.changed:
            fallback = " · 抽取式兜底" if compression.used_fallback else ""
            yield "activity", {
                "id": uuid4().hex,
                "agent": "leader",
                "tool": "compress_context",
                "description": (
                    f"分级压缩上下文 L{compression.level} · "
                    f"{compression.original_tokens} -> {compression.final_tokens} tokens · "
                    f"覆盖 {compression.compressed_messages} 条消息 · "
                    f"{compression.model_calls} 次摘要调用{fallback}"
                ),
                "phase": "completed",
            }
        if compression_usage_changed:
            yield "usage", self.usage_snapshot()
        count = 0

        for _ in range(MAX_DELEGATIONS + 6):
            try:
                response = await self.leader.next_message(
                    messages, allow_delegation=count < MAX_DELEGATIONS
                )
            except Exception:
                self.leader.status = AgentStatus.FAILED
                yield "status", {"id": "leader", "status": AgentStatus.FAILED}
                raise
            messages.append(response)
            if self.leader.record_usage(response):
                yield "usage", self.usage_snapshot()

            if not response.tool_calls:
                content = message_text(response)
                if not content:
                    try:
                        retry = await self.leader.next_message(
                            [*messages, HumanMessage(content="请直接回复用户，不要调用工具。")],
                            allow_delegation=False,
                        )
                    except Exception:
                        self.leader.status = AgentStatus.FAILED
                        yield "status", {"id": "leader", "status": AgentStatus.FAILED}
                        raise
                    if self.leader.record_usage(retry):
                        yield "usage", self.usage_snapshot()
                    content = message_text(retry)
                yield "delta", {
                    "role": "leader",
                    "content": content or "我收到了你的消息，但模型没有返回可显示的内容。请重试。",
                }
                self.leader.status = AgentStatus.IDLE
                yield "status", {"id": "leader", "status": AgentStatus.IDLE}
                return

            batches: list[tuple[str, str, list[Delegation]]] = []
            selected_workers: set[str] = set()
            for call in response.tool_calls:
                call_id = call.get("id") or f"delegation-{count + 1}"
                tool_name = call.get("name")
                if tool_name == "checkpoint_context":
                    if len(response.tool_calls) != 1:
                        messages.append(ToolMessage(content="Call checkpoint_context alone, then delegate work", tool_call_id=call_id))
                        continue
                    try:
                        reset_handoff = ContextCheckpoint.model_validate(call.get("args", {}))
                    except ValidationError as error:
                        messages.append(ToolMessage(content=f"Invalid checkpoint: {error}", tool_call_id=call_id))
                        continue
                    self._leader_checkpoints[conversation_id] = LeaderCheckpoint(
                        handoff=reset_handoff,
                        history_cutoff=len(history),
                    )
                    self._leader_compressor.reset(conversation_id)
                    tool_result = ToolMessage(content="Coordination checkpoint saved. Continue from the handoff.", tool_call_id=call_id)
                    messages = [
                        system,
                        SystemMessage(content=reset_handoff.as_prompt()),
                        history[-1],
                        response,
                        tool_result,
                    ]
                    yield "activity", {
                        "id": uuid4().hex,
                        "agent": "leader",
                        "tool": "checkpoint_context",
                        "description": "保存阶段交接并开启干净的协调上下文",
                        "phase": "completed",
                    }
                    continue
                if tool_name not in {"delegate_task", "delegate_tasks"}:
                    messages.append(ToolMessage(content="Unknown tool call", tool_call_id=call_id))
                    continue
                try:
                    args = call.get("args", {})
                    assignments = (
                        [Delegation.model_validate(args)]
                        if tool_name == "delegate_task"
                        else DelegationBatch.model_validate(args).assignments
                    )
                except ValidationError as error:
                    messages.append(
                        ToolMessage(content=f"Invalid delegation: {error}", tool_call_id=call_id)
                    )
                    continue
                if count + sum(len(group) for _, _, group in batches) + len(assignments) > MAX_DELEGATIONS:
                    messages.append(
                        ToolMessage(content="Delegation limit reached", tool_call_id=call_id)
                    )
                    continue
                workers = {assignment.worker for assignment in assignments}
                if workers & selected_workers:
                    messages.append(
                        ToolMessage(content="A worker cannot receive concurrent assignments; assign it again after this batch", tool_call_id=call_id)
                    )
                    continue
                selected_workers.update(workers)
                batches.append((call_id, tool_name, assignments))

            if not batches:
                continue

            message_id = uuid4().hex
            jobs: list[tuple[str, str, Delegation, str]] = []
            mentions: list[dict[str, str]] = []
            for call_id, tool_name, assignments in batches:
                for assignment in assignments:
                    count += 1
                    worker = self.workers[assignment.worker]
                    event_id = uuid4().hex
                    jobs.append((call_id, tool_name, assignment, event_id))
                    mentions.append({"worker": assignment.worker, "name": worker.spec.name, "summary": assignment.summary})

            yield "chat_message", {
                "id": message_id,
                "sender": "leader",
                "content": "\n".join(f"@{item['name']} {item['summary']}" for item in mentions),
                "mentions": mentions,
            }
            for _, tool_name, assignment, event_id in jobs:
                worker = self.workers[assignment.worker]
                yield "activity", {
                    "id": event_id,
                    "agent": "leader",
                    "tool": tool_name,
                    "description": f"将工作交给{worker.spec.name}",
                    "phase": "running",
                }
                worker.status = AgentStatus.RUNNING
                yield "status", {"id": assignment.worker, "status": AgentStatus.RUNNING}

            queue: asyncio.Queue[tuple[str, dict]] = asyncio.Queue()
            tasks = [
                asyncio.create_task(
                    self._run_assignment(call_id, tool_name, assignment, event_id, message_id, conversation_id, queue)
                )
                for call_id, tool_name, assignment, event_id in jobs
            ]
            results: dict[tuple[str, str], str] = {}
            failures: list[Exception] = []
            remaining = len(tasks)
            try:
                while remaining:
                    event, payload = await queue.get()
                    if event == "_finished":
                        remaining -= 1
                        if payload["error"] is not None:
                            failures.append(payload["error"])
                        else:
                            results[(payload["call_id"], payload["worker"])] = payload["output"]
                    else:
                        yield event, payload
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)

            if failures:
                raise failures[0]
            for call_id, _, assignments in batches:
                lines = [
                    f"{assignment.worker}: {results[(call_id, assignment.worker)] or 'Specialist completed without text output'}"
                    for assignment in assignments
                ]
                messages.append(ToolMessage(content="\n\n".join(lines)[-12000:], tool_call_id=call_id))

        self.leader.status = AgentStatus.FAILED
        yield "status", {"id": "leader", "status": AgentStatus.FAILED}
        raise RuntimeError("Leader exceeded the coordination turn limit")

    async def _run_assignment(
        self,
        call_id: str,
        tool_name: str,
        assignment: Delegation,
        event_id: str,
        message_id: str,
        conversation_id: str,
        queue: asyncio.Queue[tuple[str, dict]],
    ) -> None:
        worker = self.workers[assignment.worker]
        output: list[str] = []
        error: Exception | None = None
        context_label = "上下文准备中"
        await queue.put(("read_receipt", {"message_id": message_id, "reader": assignment.worker}))
        await queue.put(("chat_message", {
            "id": f"{event_id}-ack",
            "sender": assignment.worker,
            "content": WORKER_ACK[assignment.worker],
        }))
        try:
            async for event, payload in worker.stream(
                assignment.task,
                conversation_id=conversation_id,
                context_mode=assignment.context_mode,
                handoff=assignment.handoff,
            ):
                if event == "content":
                    output.append(payload["content"])
                elif event == "context":
                    if payload.get("compression_level"):
                        context_label = f"压缩上下文 L{payload['compression_level']}"
                    else:
                        context_label = "干净上下文" if payload["mode"] == "fresh" else "续接上下文"
                    await queue.put(("activity", {
                        "id": event_id,
                        "agent": "leader",
                        "tool": tool_name,
                        "description": f"将工作交给{worker.spec.name} · {context_label}",
                        "phase": "running",
                    }))
                elif event == "activity":
                    await queue.put(("activity", {"agent": assignment.worker, **payload}))
                elif event == "usage":
                    await queue.put(("usage", self.usage_snapshot()))
        except Exception as cause:
            error = cause
            try:
                await worker.discard_session(conversation_id)
            except Exception:
                # The original worker error must still reach the queue consumer.
                logger.exception("Failed to discard worker session after assignment error")
            worker.status = AgentStatus.FAILED
            await queue.put(("status", {"id": assignment.worker, "status": AgentStatus.FAILED}))
        else:
            worker.status = AgentStatus.IDLE
            await queue.put(("status", {"id": assignment.worker, "status": AgentStatus.IDLE}))
            await queue.put(("message_reaction", {
                "message_id": message_id,
                "worker": assignment.worker,
                "reaction": "done",
            }))
        await queue.put(("activity", {
            "id": event_id,
            "agent": "leader",
            "tool": tool_name,
            "description": f"将工作交给{worker.spec.name} · {context_label}",
            "phase": "failed" if error else "completed",
        }))
        await queue.put(("_finished", {
            "call_id": call_id,
            "worker": assignment.worker,
            "output": "".join(output)[-12000:],
            "error": error,
        }))


@lru_cache(maxsize=1)
def get_team() -> Team:
    return Team()
