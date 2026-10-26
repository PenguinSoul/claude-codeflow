---
description: Read the pull request checks without merging
allowed-tools: Bash(codeflow:*)
---

Run `codeflow watch --json` for a one-shot snapshot. Use `--wait` only when the
human explicitly asks to wait for checks.

Report the check state. Never merge and never rerun an unrelated failing job
without the human's request.
