# Browser acceptance scripts

These are the original independent acceptance scripts used with the generated guestbook projects. They test the generated websites, not the Wdrunge control API.

Requirements: Node.js, Node Playwright with Chromium, npm dependencies in the generated frontend, and a Python environment at backend/.venv with the generated backend dependencies. Use an unused output directory and free ports 8100 and 15173.

```sh
node evaluation/scripts/guestbook-r1.mjs /path/to/r1-website /path/to/new-output
node evaluation/scripts/guestbook-pair-b.mjs /path/to/r2b-website /path/to/new-output /path/to/old-guestbook.db
```

The category seed database must contain the legacy message with ID 1 and the exact nickname/content specified in guestbook-pair-b.mjs. The scripts start and stop real local services, write acceptance/result files in the chosen output directory and use Chinese UI selectors from the original task. R3's original and targeted recheck scripts are retained as guestbook-r3.mjs and guestbook-r3-targeted.mjs. No model API calls are made by these scripts.

## Availability and reproduction limits

The original generated guestbook workspaces and historical SQLite seed database are not included in this source snapshot. The original acceptance scripts are retained as historical evaluation materials; they cannot be rerun against the Wdrunge application itself. The archived inputs, acceptance records, metrics and screenshots can be inspected and checked independently with `python3 evaluation/evaluate_saved.py` from the repository root.

To attempt a new live evaluation, use the original R1 input in ../traces/R1/original-input.txt to generate the base guestbook in a local starter workspace. Use separate copies of that base for the R2b and R3 original inputs. For the category migration check, before upgrading the base website, create a fresh legacy database through its original backend and publish exactly one message (nickname: `旧访客`, content: `R2升级前留言`); verify that its ID is 1 and preserve a copy of app.db as the seed. This is a reconstruction procedure, not the original historical database. Replace historical absolute paths in prompts with the actual local workspace paths, and install the generated projects' dependencies according to their own setup instructions.

The historical scripts assume macOS/Linux-style `backend/.venv/bin/python`, the original API and DOM selectors, and the specified local ports. Node Playwright must be resolvable by the scripts. A newly generated site may differ in implementation or selectors; exact reproduction and successful reruns are not established. No new live test was performed while preparing this documentation.
