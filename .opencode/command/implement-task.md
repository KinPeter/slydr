---
description: Implement a Slydr ticket end-to-end (implement, review, fix, commit).
agent: slydr-orchestrator
---

Implement Slydr ticket `$ARGUMENTS` (e.g. `/implement-task T004`).

Validate the ID (`T[0-9]{3}`), then run the full pipeline: `slydr-implementer` → `slydr-reviewer` (writes `docs/reviews/<TASK_ID>-review.md`) → `slydr-fixer` → verify (`typecheck`, `lint`, `test`, `format:check`) → commit `feat(<TASK_ID>): <title>` → ask me to test manually.

One ticket per run. If the tree is dirty, if any step fails, or if a functionality question needs my call, stop and ask me.
