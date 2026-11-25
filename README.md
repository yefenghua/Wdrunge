# Wdrunge: A Multi-Agent Collaborative System for Web Development

Group 62 | COMP7608B Final Project | 2026–2027 | Version 0.1.0

## Team members

- Lujia Zhang
- Jiayi Zhou
- Ketian Li

Group number: 62.

Wdrunge develops and revises local websites from natural-language requests. A Leader coordinates Product, Designer, Frontend, Backend and Testing agents using task dependencies, shared artifacts, role-scoped tools, persistent context and delivery checks. Users can inspect team activity, preview the website and submit element or region annotations.

## Requirements

- Python 3.13 (repository pin; package metadata permits >=3.11), uv, Node.js and npm.
- Alibaba Cloud Model Studio account with access to the configured Qwen models (metered API).
- SQLite is used for application state by default.
- Optional: Playwright and Chromium for browser verification; Rust and Tauri platform prerequisites for desktop mode.

Resolved dependencies: backend/uv.lock, frontend/package-lock.json, frontend/src-tauri/Cargo.lock. Backend uses FastAPI, LangChain and LangGraph; frontend uses React 19, TypeScript 6, Vite 8 and Three.js. The recorded Windows integration used Python 3.13.15 and Node.js 24.12.0.

## Setup and run

Install the prerequisites above before starting. Both platforms use the same model configuration and application ports.

### Backend

From the repository root:

```sh
cd backend
cp .env.example .env
# Set DASHSCOPE_API_KEY in .env before starting.
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 17420
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp .env.example .env`.

### Frontend

In a second terminal, from the repository root:

```sh
cd frontend
npm install
npm run dev
```

### Access the application

Open http://localhost:1420 and select a local project workspace. API health: http://127.0.0.1:17420/api/health; schema: http://127.0.0.1:17420/docs; team: http://127.0.0.1:17420/api/team. Set VITE_API_BASE_URL if the backend address differs. For desktop mode, run npm run tauri:dev from frontend/ after installing Tauri prerequisites.

For a database schema upgrade, run uv run alembic upgrade head from backend/. Avoid --reload during active agent execution. Do not overwrite an existing configured .env file.

Optional Python browser tools (from backend/, on either platform):

```sh
uv sync --extra browser
uv run playwright install chromium
```

## Model settings

Defaults in backend/.env.example:

| Purpose | Setting |
| --- | --- |
| Main agent | qwen3.7-max |
| Context summary | qwen3.7-plus |
| Conversation title | qwen-flash |
| Automatic approval review | qwen-flash |
| Provider | Alibaba Cloud Model Studio, OpenAI-compatible China (Beijing) endpoint |
| Endpoint | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| Configured context window | 131072 tokens |

The context-window setting is an application assumption, not a verified provider capacity. Model routing, fallback, retry and context settings are in the environment template and [backend README](backend/README.md). Historical runs may use different models; record actual configuration for each evaluation.

## Evaluation

Backend (from backend/):

```sh
uv run python -m pytest -q
uv run python -m pytest -q tests/test_resilience_routing.py tests/test_tool_call_reliability.py
uv run python scripts/benchmark_overhead.py
uv run python scripts/benchmark_worker_step.py 20 --runs 1
```

Frontend (from frontend/):

```sh
npm run build
npm run test:messages
npm run test:characters
```

Optional browser regressions require a running Vite server and Node Playwright. Install locally with npm install --no-save --package-lock=false playwright and npx playwright install chromium, or set WDRUNGE_PLAYWRIGHT_MODULE to an existing module.

```sh
node scripts/visual-feedback.test.mjs
node scripts/preview-refresh.test.mjs
```

See [evaluation guide](evaluation/README.md) for three recorded cases: R1 guestbook development, R2b category/filtering extension, and original R3 scope-control failure. Check their saved results and evidence hashes from the repository root:

```sh
python3 evaluation/evaluate_saved.py
```

The evidence check makes no model calls. Case metrics, original inputs, acceptance logs and screenshots are included under evaluation/. Recorded live cases are separate from application regression checks.

The recorded 24 November Windows integration reported 487 passed, 84 failed, 25 skipped in the backend suite. Frontend build, message/character tests, browser fixture tests and a temporary-database API smoke check passed. Browser fixtures mock backend/model calls. Native execution and a fresh setup on the final snapshot remain unverified.

## Repository layout

- backend/app/ — API, agents, prompts, tools, state and collaboration.
- backend/app/agents/prompts/ — runtime agent instructions.
- backend/tests/ and backend/scripts/ — regression checks and benchmarks.
- frontend/ — React UI, preview and optional Tauri desktop app.
- docs/ — design documentation and historical run analyses.
- evaluation/ — sample inputs, results and trace index.
- ai_assistance/ — AI-use declaration and representative development prompts.

## Security and limitations

Do not commit API keys, .env, generated credentials, private databases or unredacted logs. Task isolation is not a complete security boundary. Preview and annotation constraints are documented in [visual feedback](docs/visual-feedback.md).

## Submission and version

See [VERSION.txt](VERSION.txt), [integration notes](docs/final-integration.md), [frontend README](frontend/README.md), [changes](CHANGELOG.md) and [missing items](MISSING_ITEMS.md). Source revision is identified by the archive's commit SHA. Package the complete tracked source as a ZIP, with the report PDF submitted separately.

