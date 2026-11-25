# Evaluation results

Group 62 | Wdrunge: A Multi-Agent Collaborative System for Web Development

| Case | Functional result | Overall result | Formal reworks | Tokens | Model calls |
| --- | --- | --- | ---: | ---: | ---: |
| R1: Guestbook | 20/20 final checks passed | Passed after documentation rework | 1 | 4,580,414 | 300 |
| R2b: Category extension | 4/4 groups passed | Passed | 0 | 2,976,198 | 199 |
| R3: Scope control | 4/4 groups passed after rework | Failed: unrequested follow-on task | 1 | 2,487,880 | 152 |

[Machine-readable results](cases.json) are derived from the archived case metrics. Token totals include recorded coordination, review, summary and failed calls. Cache tokens are already part of input tokens.

## Application checks

The recorded 24 November Windows integration used Python 3.13.15, Node 24.12.0 and Vite 8.3.2. These application checks are separate from the three live development cases above.

| Check | Recorded result |
| --- | --- |
| Frontend production build | Passed |
| Message/execution/formal acceptance | 20 passed |
| Character/office checks | 30 passed |
| Browser annotation and cache refresh | Passed with mocked requests |
| FastAPI smoke check | Passed without model calls |
| Backend full suite | 487 passed, 84 failed, 25 skipped |

See [integration notes](../../docs/final-integration.md) for the application check record.
