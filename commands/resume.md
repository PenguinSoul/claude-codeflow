---
description: Resume a blocked task after the block is resolved
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/codeflow:*)
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/codeflow" resume --json` only after the human has resolved the block.

Do not retry a blocked command blindly. If the block is a conflict or an
ambiguous requirement, stop and ask the human to decide.
