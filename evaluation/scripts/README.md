# Browser acceptance scripts

These are the original independent acceptance scripts used with the generated guestbook projects. They test the generated websites, not the Wdrunge control API.

Requirements: Node.js, Node Playwright with Chromium, npm dependencies in the generated frontend, and a Python environment at backend/.venv with the generated backend dependencies. Use an unused output directory and free ports 8100 and 15173.

```sh
node evaluation/scripts/guestbook-r1.mjs /path/to/r1-website /path/to/new-output
node evaluation/scripts/guestbook-pair-b.mjs /path/to/r2b-website /path/to/new-output /path/to/old-guestbook.db
```

The category seed database must contain the legacy message with ID 1 and the exact nickname/content specified in guestbook-pair-b.mjs. The scripts start and stop real local services, write acceptance/result files in the chosen output directory and use Chinese UI selectors from the original task. R3's original and targeted recheck scripts are retained as guestbook-r3.mjs and guestbook-r3-targeted.mjs. No model API calls are made by these scripts.
