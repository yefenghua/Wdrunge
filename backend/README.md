# Backend

Python API for the Wdrunge desktop/web frontend. The chat endpoint accepts a JSON `POST` and returns Server-Sent Events. A Leader agent can answer directly or function-call a specialist when the user request needs project work.

## Run

```sh
cd backend
cp .env.example .env
# Set DASHSCOPE_API_KEY in .env
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` for the API schema. The frontend runs separately with `cd frontend && npm run dev`.

The agent calls Alibaba Cloud Model Studio through its OpenAI-compatible API. The default model is `qwen3.7-max`. Set `DASHSCOPE_API_KEY` in `.env`; `QWEN_MODEL` and `DASHSCOPE_BASE_URL` can be changed for another model or region. The default URL uses the China (Beijing) endpoint.

Run Uvicorn without `--reload` while an agent may edit backend files; automatic reload would interrupt the active SSE request.

FastAPI builds `/openapi.json` from the Pydantic request/response models. To update the checked-in schema and generated frontend types after changing an endpoint:

```sh
cd backend
uv run python -m scripts.export_openapi
cd ../frontend
npm run api:generate
```

The repository's `docs/` directory is reserved for project design documents; it is unrelated to FastAPI's `/docs` route.

## Streaming contract

`POST /api/chat/stream` with `Content-Type: application/json`:

```json
{"conversation_id":"chat-123","messages":[{"role":"user","content":"What time is it?"}]}
```

The response uses `text/event-stream`. `status` events contain an agent ID and `idle`, `running`, or `failed` state. `chat_message` contains short public team updates; all assignments from one Leader batch share one multiline message with structured `mentions`. `read_receipt` marks one member's @mention as read; `message_reaction` adds that member's `done` reaction under the assignment message. `activity` reports tool calls without their arguments. `usage` reports cumulative model tokens and each member's latest prompt context occupancy. `delta` contains the Leader's answer; `done` marks completion; `error` contains a safe message if generation fails after streaming starts. Each request includes the full conversation history and the same `conversation_id` for that chat. The frontend saves conversations locally. Separate user requests run one at a time, while independent members within a batch run concurrently.

Each delegation uses `context_mode`: `fresh` starts a clean worker thread, `continue` resumes that worker's thread in the same chat, and `auto` resumes a known thread while allowing the runtime to compress its old context. If usage is unavailable, `auto` starts fresh. If there is no saved thread, `continue` starts fresh. Every delegation also carries a private `handoff` with the goal, constraints, and relevant artifact paths. A fresh worker receives its role prompt, the current task, and this handoff; it does not receive the old chat transcript. The Leader may call `checkpoint_context` at a stage boundary to save a structured goal, constraints, artifacts, completed work, and pending work. Subsequent Leader calls in that chat use the checkpoint and later messages instead of older history.

Leader and worker prompts use progressive context compression instead of sending the complete history to a summarizer. Below the soft threshold, recent context remains verbatim. Above it, only the expired prefix is split into bounded chunks, summarized independently, and merged into a rolling summary. Higher levels retain fewer raw messages; the hard level protects the role prompt, manual checkpoint, and latest user request, with an extractive fallback if the summarizer fails. See [the context compression design](../docs/design/context-compression-strategy.md) for invariants and failure behavior.

Worker threads and Leader checkpoints live in backend memory. Restarting the backend clears them, so the next worker assignment starts fresh. Keep important decisions in project documents as well as handoffs.

Set `QWEN_CONTEXT_WINDOW` to the actual context limit of the configured model. The default `131072` is an application assumption for the draft UI, not a verified property of every Qwen model. Context percentage uses the latest reported input-token count divided by that configured limit. Cumulative token counts use provider-reported usage; no number is invented when usage is missing.

Compression defaults can be tuned with `CONTEXT_COMPRESSION_SOFT_RATIO`, `CONTEXT_COMPRESSION_MEDIUM_RATIO`, `CONTEXT_COMPRESSION_HARD_RATIO`, `CONTEXT_COMPRESSION_TARGET_RATIO`, `CONTEXT_RESERVED_OUTPUT_TOKENS`, `CONTEXT_COMPRESSION_CHUNK_TOKENS`, `CONTEXT_COMPRESSION_SUMMARY_TOKENS`, and the three `CONTEXT_COMPRESSION_L*_RECENT` variables. Ratios must satisfy `target < soft < medium < hard < 1`.

`GET /api/health` returns `{"status":"ok"}`.

`GET /api/team` lists all six ready agents, their current status, tool names, and skill files.

## Team modules

- `app/agents/base.py` defines the reusable `Agent` and `AgentSpec` classes.
- `app/agents/leader.py` lets the Leader reply directly, function-call `delegate_task` or `delegate_tasks`, and save a `checkpoint_context`.
- `app/agents/worker.py` runs each specialist through a LangGraph tool loop with per-chat memory checkpoints.
- `app/agents/team.py` registers the six agents, executes delegation calls, and returns each worker's result to the Leader.
- `app/agents/prompts/` contains each role's system prompt; `app/agents/skills/` contains optional role skill instructions.
- `app/tools/` contains one Python module per tool. File tools are restricted to each role's assigned project paths.

The Leader can select any subset of members and call a member more than once over successive turns. Independent assignments in `delegate_tasks` run concurrently; dependent work waits for their results. For example, designer and frontend can exchange refinements over several calls. Greetings need no delegation. All members are initialized as `idle` on API startup and become `running` only during their assignment.
