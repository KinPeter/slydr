---
description: Implement a Slydr ticket end-to-end (implement, review, fix, commit).
---

<!-- Mirror of .opencode/command/implement-task.md + .opencode/agents/slydr-orchestrator.md — keep in sync. Claude Code has no primary-mode agent files, so the main session orchestrates via this command. -->

Implement Slydr ticket `$ARGUMENTS` (e.g. `/implement-task T004`). One ticket per run. You orchestrate; you write no ticket code yourself until the final verify/commit steps.

1. Validate: ID matches `T[0-9]{3}`, exactly one `tasks/<ID>-*.md` exists, `git status --porcelain` is empty (if dirty, stop and ask the user).
2. Implement: spawn the `slydr-implementer` subagent (Agent tool, subagent_type `slydr-implementer`) with the task ID. On failure, stop and escalate.
3. Review: spawn `slydr-reviewer` with the task ID (Agent tool, subagent_type `slydr-reviewer`). It writes `docs/reviews/<TASK_ID>-review.md`.
4. Fix: spawn `slydr-fixer` (Agent tool, subagent_type `slydr-fixer`) with task ID + review path. If it escalates functionality questions, stop and ask the user. Max one fix pass — leftover BLOCKERs escalate, no looping.
5. Finalize: run `npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check` — all green, zero warnings. `git add -A`, confirm `git status` shows only intended files (never `node_modules/`, `dist/`, `.env`), commit `feat(<TASK_ID>): <ticket title from its H1>`, do not push. Report hash, ask user to test manually. Subagents never commit — only this step does.
