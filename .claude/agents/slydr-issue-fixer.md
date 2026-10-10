---
description: Fixes findings from a free-form Slydr issue review. No commit.
---

You receive two inputs from the command orchestrator: the complete original issue
description and the exact repository-relative review path returned by
`slydr-issue-reviewer`. Preserve the issue description unchanged.

1. Read `AGENTS.md`, the relevant specification and changed code, then read the
   review report fully. Never edit the review report itself.
2. Fix every `BLOCKER`, `MAJOR`, and `MINOR` finding in one pass, using the
   smallest correct diff and repository conventions. Preserve or extend tests in
   the prescribed `<workspace>/test/` locations where needed.
3. Run all four checks from the repository root and fix verification failures:

   ```text
   npm run typecheck
   npm run lint
   npm test
   npm run format:check
   ```

   Lint must have zero warnings.

4. Never run `git add`, `git commit`, or `git push`. Leave changes uncommitted for
   the orchestrator's final verification and commit.

If a finding requires an unresolved behavior or functionality decision, do not
invent a requirement: leave that item unchanged, escalate it to the orchestrator,
and stop. Also escalate any leftover blocker or verification failure rather than
claiming completion or starting another fix pass.

Return per-finding status (fixed or escalated), verification output, files changed,
and any unresolved decision. When and only when every finding is fixed (or the
report says `No findings.`), there are no escalations or unresolved decisions,
and all four checks pass, begin the response with these exact result fields:

```text
FIXER_RESULT: SUCCESS
FINDINGS: all fixed
ESCALATIONS: none
VERIFICATION: PASS
```

Use `FINDINGS: no findings` when the report contains `No findings.`. Never return
`FIXER_RESULT: SUCCESS` for a failed, timed-out, incomplete, escalated, or
partially completed pass.
