# Evaluation

Group 62 | Wdrunge: A Multi-Agent Collaborative System for Web Development

Three recorded cases cover development, a changed request and a scope-control failure.

| Case | Task | Result |
| --- | --- | --- |
| [R1](sample_inputs/01_ordinary_task.md) | Build a guestbook website | Passed after one documentation rework; 20/20 final checks |
| [R2b](sample_inputs/02_changed_request.md) | Add categories and filtering | Passed all four acceptance groups on first delivery |
| [R3](sample_inputs/03_failure_cases.md) | Keep development within the requested scope | Functional checks passed after rework; scope control failed |

Check the archived evidence from the repository root:

```sh
python3 evaluation/evaluate_saved.py
```

This command checks saved results and file hashes without model calls. Application test commands are in the root README. Case metrics are in [results](results/README.md); original inputs, outputs and event snapshots are in [traces](traces/README.md).

Models recorded for these cases: qwen3.7-max (main), qwen-flash (approval review). The cases ran on 14 November 2026, UTC+08:00, using local React/TypeScript, FastAPI and SQLite projects. Browser checks used a 1440 x 900 viewport. R1 used an existing starter project; R2b and R3 used independent copies of the base guestbook and new conversations.

Historical browser acceptance scripts are in [scripts](scripts/README.md). The records describe those runs; the evidence check does not rerun website development.
