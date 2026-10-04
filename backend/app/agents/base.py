"""Shared configuration and lifecycle state for every team member."""

from dataclasses import dataclass, field
from enum import StrEnum
import os
from pathlib import Path

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langchain_openai import ChatOpenAI


class AgentStatus(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    FAILED = "failed"


@dataclass(frozen=True)
class AgentSpec:
    id: str
    name: str
    prompt_file: str
    tools: tuple[BaseTool, ...] = ()
    skills: tuple[str, ...] = ()
    context_window: int | None = None


@dataclass
class Agent:
    """A configured, ready team member. Model calls begin only when assigned work."""

    spec: AgentSpec
    status: AgentStatus = field(default=AgentStatus.IDLE, init=False)
    total_tokens: int = field(default=0, init=False)
    context_tokens: int = field(default=0, init=False)

    def context_window(self) -> int:
        if self.spec.context_window:
            return self.spec.context_window
        try:
            return max(1, int(os.getenv("QWEN_CONTEXT_WINDOW", "131072")))
        except ValueError:
            return 131072

    def record_usage(self, response: object) -> bool:
        """Track reported model usage; never guess when the provider omits it."""
        usage = getattr(response, "usage_metadata", None) or {}
        metadata = getattr(response, "response_metadata", None) or {}
        fallback = metadata.get("token_usage") if isinstance(metadata, dict) else None
        if not isinstance(usage, dict):
            usage = {}
        if not isinstance(fallback, dict):
            fallback = {}
        input_tokens = usage.get("input_tokens", fallback.get("prompt_tokens"))
        total_tokens = usage.get("total_tokens", fallback.get("total_tokens"))
        if not isinstance(total_tokens, int) or total_tokens < 0:
            return False
        self.total_tokens += total_tokens
        if isinstance(input_tokens, int) and input_tokens >= 0:
            self.context_tokens = input_tokens
        return True

    def usage_snapshot(self) -> dict:
        window = self.context_window()
        return {
            "id": self.spec.id,
            "total_tokens": self.total_tokens,
            "context_tokens": self.context_tokens,
            "context_window": window,
            "context_percent": round(min(100.0, self.context_tokens * 100 / window), 2),
        }

    def system_prompt(self) -> str:
        root = Path(__file__).resolve().parent
        parts = [(root / "prompts" / self.spec.prompt_file).read_text(encoding="utf-8")]
        for skill in self.spec.skills:
            parts.append((root / "skills" / skill).read_text(encoding="utf-8"))
        return "\n\n".join(parts)

    def model(self) -> ChatOpenAI:
        return ChatOpenAI(
            model=os.getenv("QWEN_MODEL", "qwen3.7-max"),
            api_key=os.environ["DASHSCOPE_API_KEY"],
            base_url=os.getenv(
                "DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
            ),
        )

    async def summarize_context(self, request: str) -> AIMessage:
        """Run the shared no-tools summarizer for bounded context compression."""
        root = Path(__file__).resolve().parent
        prompt = (root / "prompts" / "context_compressor.md").read_text(
            encoding="utf-8"
        )
        return await self.model().ainvoke(
            [SystemMessage(content=prompt), HumanMessage(content=request)]
        )

    def snapshot(self) -> dict:
        return {
            "id": self.spec.id,
            "name": self.spec.name,
            "status": self.status,
            "tools": [tool.name for tool in self.spec.tools],
            "skills": list(self.spec.skills),
        }
