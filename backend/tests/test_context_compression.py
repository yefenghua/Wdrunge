import asyncio

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.context import CompressionPolicy, ContextCompressor
from app.context.compression import estimate_text_tokens


def policy() -> CompressionPolicy:
    return CompressionPolicy(
        soft_ratio=0.30,
        medium_ratio=0.50,
        hard_ratio=0.75,
        target_ratio=0.20,
        reserved_output_tokens=0,
        chunk_tokens=300,
        summary_tokens=60,
        recent_messages_l1=4,
        recent_messages_l2=2,
        recent_messages_l3=1,
    )


def history(turns: int, width: int = 80) -> list:
    messages = []
    for index in range(turns):
        messages.extend(
            [
                HumanMessage(content=f"user-{index}-" + "u" * width),
                AIMessage(content=f"assistant-{index}-" + "a" * width),
            ]
        )
    messages.append(HumanMessage(content="latest-user-request"))
    return messages


def test_small_context_is_not_compressed():
    compressor = ContextCompressor(policy())
    calls = []

    async def summarize(request, target):
        calls.append((request, target))
        return "unused"

    source = [HumanMessage(content="hello")]
    result = asyncio.run(
        compressor.prepare(
            conversation_id="chat-a",
            protected_messages=[SystemMessage(content="system")],
            history=source,
            context_window=1000,
            summarize=summarize,
        )
    )

    assert result.level == 0
    assert not result.changed
    assert result.messages[-1].content == "hello"
    assert calls == []


def test_old_turns_are_chunked_and_recent_raw_messages_are_kept():
    compressor = ContextCompressor(policy())
    calls = []

    async def summarize(request, target):
        calls.append(request)
        return f"structured summary {len(calls)}"

    source = history(8)
    result = asyncio.run(
        compressor.prepare(
            conversation_id="chat-a",
            protected_messages=[SystemMessage(content="system")],
            history=source,
            context_window=1000,
            summarize=summarize,
        )
    )

    assert result.level >= 1
    assert result.compressed_messages > 0
    assert result.model_calls == len(calls)
    assert len(calls) > 1
    assert all(estimate_text_tokens(request) <= policy().chunk_tokens for request in calls)
    assert any(
        isinstance(message, SystemMessage)
        and "Automatic rolling context summary" in message.content
        for message in result.messages
    )
    assert result.messages[-1].content == "latest-user-request"


def test_incremental_compression_does_not_resummarize_covered_prefix():
    compressor = ContextCompressor(policy())
    calls = []

    async def summarize(request, target):
        calls.append(request)
        return f"summary-{len(calls)}"

    source = history(7)
    first = asyncio.run(
        compressor.prepare(
            conversation_id="chat-a",
            protected_messages=[SystemMessage(content="system")],
            history=source,
            context_window=1000,
            summarize=summarize,
        )
    )
    covered = compressor.export_state("chat-a")["covered_count"]
    assert covered > 0

    calls.clear()
    extended = [
        *source[:-1],
        HumanMessage(content="new-follow-up-" + "n" * 100),
        AIMessage(content="new-answer-" + "r" * 100),
        HumanMessage(content="latest-user-request"),
    ]
    second = asyncio.run(
        compressor.prepare(
            conversation_id="chat-a",
            protected_messages=[SystemMessage(content="system")],
            history=extended,
            context_window=1000,
            summarize=summarize,
            observed_tokens=600,
        )
    )

    raw_calls = [call for call in calls if "summarize raw conversation" in call]
    assert second.compressed_messages > 0
    assert raw_calls
    assert all("user-0-" not in call for call in raw_calls)
    assert compressor.export_state("chat-a")["covered_count"] > covered
    assert first.messages[-1].content == second.messages[-1].content


def test_changed_history_prefix_invalidates_cached_summary():
    compressor = ContextCompressor(policy())

    async def summarize(_request, _target):
        return "summary"

    source = history(6)
    asyncio.run(
        compressor.prepare(
            conversation_id="chat-a",
            protected_messages=[],
            history=source,
            context_window=800,
            summarize=summarize,
        )
    )
    original_digest = compressor.export_state("chat-a")["covered_digest"]
    changed = [HumanMessage(content="edited-prefix"), *source[1:]]
    asyncio.run(
        compressor.prepare(
            conversation_id="chat-a",
            protected_messages=[],
            history=changed,
            context_window=800,
            summarize=summarize,
        )
    )

    assert compressor.export_state("chat-a")["covered_digest"] != original_digest


def test_conversations_are_isolated_and_state_is_serializable():
    compressor = ContextCompressor(policy())

    async def summarize(_request, _target):
        return "summary-a"

    asyncio.run(
        compressor.prepare(
            conversation_id="chat-a",
            protected_messages=[],
            history=history(5),
            context_window=700,
            summarize=summarize,
        )
    )
    saved = compressor.export_state("chat-a")
    assert saved and saved["covered_count"] > 0
    assert compressor.export_state("chat-b") is None

    restored = ContextCompressor(policy())
    restored.restore_state("chat-a", saved)
    assert restored.export_state("chat-a") == saved


def test_summarizer_failure_uses_extractive_fallback():
    compressor = ContextCompressor(policy())

    async def fail(_request, _target):
        raise RuntimeError("model unavailable")

    source = history(5)
    result = asyncio.run(
        compressor.prepare(
            conversation_id="chat-a",
            protected_messages=[SystemMessage(content="system")],
            history=source,
            context_window=380,
            summarize=fail,
        )
    )

    assert result.level == 3
    assert result.used_fallback
    assert result.model_calls == 1
    assert result.messages[-1].content == "latest-user-request"
    assert "extractive fallback" in compressor.export_state("chat-a")["summary"]


def test_single_oversized_latest_message_is_clipped_at_both_ends():
    compressor = ContextCompressor(policy())
    content = "BEGIN-" + "x" * 3000 + "-END"

    async def summarize(_request, _target):
        return "unused"

    result = asyncio.run(
        compressor.prepare(
            conversation_id="chat-a",
            protected_messages=[SystemMessage(content="system")],
            history=[HumanMessage(content=content)],
            context_window=200,
            summarize=summarize,
        )
    )

    clipped = result.messages[-1].content
    assert result.hard_trimmed
    assert clipped.startswith("BEGIN-")
    assert clipped.endswith("-END")
    assert "middle omitted" in clipped
