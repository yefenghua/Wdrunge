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
{"conversation_id":"chat-123","workspace_path":"/absolute/path/to/project","messages":[{"role":"user","content":"What time is it?"}]}
```

The response uses `text/event-stream`. `status` events contain an agent ID and `idle`, `running`, or `failed` state. `chat_message` contains short public team updates; all assignments from one Leader batch share one multiline message with structured `mentions`. `read_receipt` marks one member's @mention as read; `message_reaction` adds that member's `done` reaction under the assignment message. `activity` reports tool calls without their arguments. `usage` reports cumulative model tokens and each member's latest prompt context occupancy. `delta` contains the Leader's answer; `done` marks completion; `error` contains a safe message if generation fails after streaming starts. Each request includes the full conversation history, an absolute existing `workspace_path`, and the same `conversation_id` for that chat. The frontend saves the workspace with each conversation locally. `POST /api/workspaces/validate` checks a directory before the conversation starts. File tools resolve paths inside that selected workspace. Separate user requests run one at a time, while independent members within a batch run concurrently.

Each delegation uses `context_mode`: `fresh` starts a clean worker thread, `continue` resumes that worker's thread in the same chat, and `auto` resumes while the latest reported input is below 60% of the configured context window. If usage is unavailable, `auto` starts fresh. If there is no saved thread, `continue` starts fresh. Every delegation also carries a private `handoff` with the goal, constraints, and relevant artifact paths. A fresh worker receives its role prompt, the current task, and this handoff; it does not receive the old chat transcript. The Leader may call `checkpoint_context` at a stage boundary to save a structured goal, constraints, artifacts, completed work, and pending work. Subsequent Leader calls in that chat use the checkpoint and later messages instead of older history.

Worker threads and Leader checkpoints live in backend memory. Restarting the backend clears them, so the next worker assignment starts fresh. Keep important decisions in project documents as well as handoffs.

Set `QWEN_CONTEXT_WINDOW` to the actual context limit of the configured model. The default `131072` is an application assumption for the draft UI, not a verified property of every Qwen model. Context percentage uses the latest reported input-token count divided by that configured limit. Cumulative token counts use provider-reported usage; no number is invented when usage is missing.

`GET /api/health` returns `{"status":"ok"}`.

`GET /api/team` lists all six ready agents, their current status, tool names, and skill files.

## Team modules

- `app/agents/base.py` defines the reusable `Agent` and `AgentSpec` classes.
- `app/agents/leader.py` lets the Leader reply directly, function-call `delegate_task` or `delegate_tasks`, and save a `checkpoint_context`.
- `app/agents/worker.py` runs each specialist through a LangGraph tool loop with per-chat memory checkpoints.
- `app/agents/team.py` registers the six agents, executes delegation calls, and returns each worker's result to the Leader.
- `app/agents/prompts/` contains each role's system prompt; `app/agents/skills/` contains optional role skill instructions.
- `app/tools/` contains one Python module per tool. File tools are restricted to each role's assigned project paths.

## Project file tools

Each specialist receives the following tools for working inside the project selected by the user:

- `list_project_files()` lists up to 150 visible files and skips generated or dependency directories such as `.git`, `.venv`, `node_modules`, `dist`, and `__pycache__`.
- `read_project_file(path, start_line=1, end_line=None)` reads UTF-8 text. Large files can be inspected in ranges of at most 400 lines, and one response is limited to 30,000 characters.
- `create_project_directory(path)` creates a directory and any missing parent directories. Calling it for an existing directory is safe.
- `write_project_file(path, content)` creates a UTF-8 text file or intentionally replaces its complete contents. Content is limited to 100,000 characters.
- `replace_project_text(path, old_text, new_text, expected_replacements=1)` edits an existing UTF-8 file only when the exact match count is the expected value. A mismatch leaves the file unchanged, preventing an outdated or ambiguous edit from modifying the wrong code.

Paths must be relative to the selected workspace. Absolute paths, `..` traversal, and paths outside the worker's assigned area are rejected. Workers are instructed to list and read current files first, use `write_project_file` for new files or deliberate full rewrites, and prefer `replace_project_text` for targeted changes to existing files.

The Leader can select any subset of members and call a member more than once over successive turns. Independent assignments in `delegate_tasks` run concurrently; dependent work waits for their results. For example, designer and frontend can exchange refinements over several calls. Greetings need no delegation. All members are initialized as `idle` on API startup and become `running` only during their assignment.
